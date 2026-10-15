// What the UI and the assistant do to the song. Each action is one undoable edit.
import {
  CAT,
  customSoundId,
  instrumentPatch,
  saveSound,
  soundOf,
  startingPatch,
  type Patch,
  type Sound,
  NOTE_NAMES,
  SPB,
  applyGroove,
  applyVariation,
  carve,
  clipById,
  demoSong,
  emptySong,
  localVariations,
  makeClip,
  makeTrack,
  migrate,
  nid,
  overlaps,
  trackById,
  tryLoopEnd,
  validSong,
  type BassGroove,
  type DrumGroove,
  type DrumTrack,
  type SynthTrack,
  type Song,
  type SoundKind,
  type Track,
  type TrackType,
  type VariationSpec,
} from "@thk/song";
import { audio, auditionNote, auditionPad, play, seek, wake } from "./audio.ts";
import { record } from "./history.ts";
import {
  addGroup,
  addMsg,
  edit,
  get,
  replaceSong,
  select,
  setSongQuiet,
  setState,
  settlePending,
  toast,
  updateGroup,
} from "./store.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const findIn = (d: Song, tid: string) => d.tracks.find((t) => t.id === tid);

// ---------- persistence ----------
export const STORE_KEY = "thk-studio-song-v1";

export function loadSaved(): Song | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    return validSong(saved) ? migrate(saved) : null;
  } catch {
    return null;
  }
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSave(song: Song) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(song));
    } catch {
      /* storage full or blocked: autosave is best effort */
    }
  }, 600);
}

/** First load: the last session, or the demo song with the bass clip selected. */
export function boot() {
  const saved = loadSaved();
  const song = saved ?? demoSong();
  const bassTr = song.tracks.find((t) => t.type === "synth" && t.clips.length) ?? song.tracks[0];
  setState({
    song,
    sel: { tid: bassTr?.id ?? null, cid: bassTr?.clips[0]?.id ?? null, row: 0 },
    status: saved ? "Restored your last session" : "Autosaves in this browser",
  });
}

// ---------- tracks and clips ----------
export function addTrack(type: TrackType) {
  edit(
    "Add track",
    (d) => {
      const n = d.tracks.filter((t) => t.type === type).length + 1;
      const t = makeTrack(type, (type === "drums" ? "Drums " : "Synth ") + n, { color: d.tracks.length % 6 });
      d.tracks.push(t);
      return t.id;
    },
    { select: (id) => ({ tid: id, cid: null, row: 0 }) },
  );
}
export function deleteTrack(tid: string) {
  edit("Delete track", (d) => {
    d.tracks = d.tracks.filter((t) => t.id !== tid);
  });
}
type AnyTrack = Omit<DrumTrack, "type"> & Omit<SynthTrack, "type">;
/** Sets one field on a track (synth-only fields are ignored on drum tracks and vice versa). */
export function setTrackProp<K extends keyof AnyTrack>(
  tid: string,
  k: K,
  v: AnyTrack[K],
  label = "Change track",
  key?: string,
) {
  edit(
    label,
    (d) => {
      const t = findIn(d, tid);
      if (t && (k in t || k === "name")) (t as unknown as AnyTrack)[k] = v;
    },
    key ? { key: key + tid } : {},
  );
}
export function setSongProp<K extends "bpm" | "swing" | "key" | "name">(k: K, v: Song[K], key?: string) {
  edit(
    "Change " + k,
    (d) => {
      d[k] = v;
    },
    key ? { key } : {},
  );
}

/** Draws a clip in an empty stretch of a lane: pattern of up to 4 bars, stopping at the next clip. */
export function drawClip(tid: string, b0: number, b1: number) {
  const tr = trackById(get().song, tid);
  if (!tr) return;
  let len = b1 - b0 + 1;
  const nextStart = Math.min(...tr.clips.filter((c) => c.start > b0).map((c) => c.start), Infinity);
  len = Math.min(len, nextStart - b0);
  if (len < 1 || tr.clips.some((c) => c.start <= b0 && b0 < c.start + c.len)) return;
  edit(
    "Draw clip",
    (d) => {
      const c = makeClip(b0, len, Math.min(len, 4));
      findIn(d, tid)!.clips.push(c);
      return c.id;
    },
    { select: (cid) => ({ tid, cid }) },
  );
}
export function addClipAt(tid: string, bar: number) {
  const tr = trackById(get().song, tid);
  if (!tr) return;
  let b = Math.max(0, bar);
  while (tr.clips.some((c) => c.start <= b && b < c.start + c.len)) b++;
  edit(
    "Add clip",
    (d) => {
      const c = makeClip(b, 1, 1);
      findIn(d, tid)!.clips.push(c);
      return c.id;
    },
    { select: (cid) => ({ tid, cid }) },
  );
}
export function duplicateClip(tid: string, cid: string) {
  const tr = trackById(get().song, tid),
    c = clipById(tr, cid);
  if (!tr || !c) return;
  const copy = { ...structuredClone(c), id: nid(), start: c.start + c.len };
  if (overlaps(tr, copy)) {
    toast("No room right after this clip. Move or shorten the next one first.");
    return;
  }
  edit(
    "Duplicate clip",
    (d) => {
      findIn(d, tid)!.clips.push(copy);
    },
    { select: () => ({ tid, cid: copy.id }) },
  );
}
export function deleteClip(tid: string, cid: string) {
  edit(
    "Delete clip",
    (d) => {
      const t = findIn(d, tid)!;
      t.clips = t.clips.filter((x) => x.id !== cid);
    },
    { select: () => ({ cid: null }) },
  );
}
export function clipEdit(
  tid: string,
  cid: string,
  label: string,
  fn: (c: Song["tracks"][number]["clips"][number], t: Track) => void,
) {
  edit(label, (d) => {
    const t = findIn(d, tid),
      c = t?.clips.find((x) => x.id === cid);
    if (t && c) fn(c, t);
  });
}
/** Clears bars on a track (used by tests and tools). */
export function clearBars(tid: string, a: number, b: number) {
  edit("Clear bars", (d) => carve(findIn(d, tid)!, a, b));
}

/** Puts a browser sound on the selected synth track or drum pad. */
export function assign(id: string) {
  const { sel, song } = get(),
    tr = trackById(song, sel.tid),
    s = soundOf(get().song, id) ?? get().library.find((x) => x.id === id);
  if (!tr || !s) {
    toast("Select a track first.");
    return;
  }
  edit("Change sound", (d) => {
    if (s.custom && !soundOf(d, id)) saveSound(d, s); // a library sound joins the song
    const t = findIn(d, tr.id)!;
    if (t.type === "synth") t.sample = id;
    else t.pads[sel.row] = id;
  });
  toast(tr.type === "synth" ? `${tr.name} now plays ${s.name}.` : `${tr.name} pad ${sel.row + 1} is now ${s.name}.`);
}
export function setPadSound(tid: string, row: number, id: string) {
  edit("Change pad sound", (d) => {
    const t = findIn(d, tid);
    if (t?.type === "drums") t.pads[row] = id;
  });
  select({ row });
  const tr = trackById(get().song, tid);
  if (tr) auditionPad(tr, row);
}
export function setSynthSound(tid: string, id: string) {
  edit("Change sound", (d) => {
    const t = findIn(d, tid);
    if (t?.type === "synth") t.sample = id;
  });
  const tr = trackById(get().song, tid);
  if (tr) {
    toast(`${tr.name} now plays ${soundOf(get().song, id)?.name ?? id}`);
    auditionNote(tr, 41);
  }
}

export function applyGrooveTo(tid: string, cid: string, g: DrumGroove | BassGroove) {
  try {
    edit(
      "Groove " + g.name,
      (d) => {
        const t = findIn(d, tid)!,
          c = t.clips.find((x) => x.id === cid)!;
        return applyGroove(d, t, c, g);
      },
      { select: (r) => ({ tid: r.trackId, cid: r.clipId ?? null }) },
    );
    toast(`${g.name} applied to ${trackById(get().song, tid)?.name}.`);
  } catch (e) {
    toast(errText(e));
  }
}

export function setKey(key: number) {
  setSongProp("key", key);
  toast("Key set to " + NOTE_NAMES[key] + ". Grooves and the assistant will use it.");
}

/** L: turn the loop on (around the selected clip, unless the user drew one) or off. */
export function toggleLoop() {
  edit("Loop", (d) => {
    if (!d.loop.on) {
      const { sel } = get(),
        c = clipById(trackById(d, sel.tid), sel.cid);
      if (c && !d.loop.userSet) d.loop = { on: true, start: c.start, end: c.start + Math.min(c.len, 8) };
      else d.loop.on = true;
    } else d.loop.on = false;
  });
}
export function setLoop(start: number, end: number) {
  edit("Set loop", (d) => {
    d.loop = { on: true, userSet: true, start, end };
  });
}

export function newSong(kind: "empty" | "demo") {
  const song = kind === "demo" ? demoSong() : emptySong();
  replaceSong(song, "New song", { tid: song.tracks[0]?.id ?? null, cid: null, row: 0 });
  if (get().playing) audio().transport.stop();
  audio().transport.pos = 0;
}

// ---------- variations: Try / Keep / Back to original ----------
export function showLocalVariations(tid: string, cid: string) {
  const s = get(),
    tr = trackById(s.song, tid),
    c = clipById(tr, cid);
  if (!tr || !c) return;
  const gid = addGroup(`Variations for ${tr.name}`, localVariations(s.song, tr, c));
  addMsg({
    kind: "bot",
    who: "Studio",
    text: `Three ${tr.type === "drums" ? "drum" : "bass"} grooves for ${tr.name}, bars ${c.start + 1}–${c.start + c.len}. Press Try to loop one in place, then Keep the one you like.`,
    groupIds: [gid],
  });
}

/** Loops a variation in place, replacing any other Try in the same group. */
export function tryVariation(gid: string, i: number) {
  wake();
  const s0 = get();
  if (s0.pending && s0.pending.groupId !== gid) settlePending();
  const s = get(),
    g = s.groups[gid],
    sp = g?.specs[i];
  if (!g || !sp) return;
  const base = s.pending?.groupId === gid ? s.pending.base : s.song;
  try {
    const end = tryLoopEnd(sp);
    const { next, cmd, result } = record(base, `Keep “${sp.name}”`, (d) => {
      const r = applyVariation(d, sp);
      d.loop = { on: true, userSet: true, start: sp.start, end };
      return r;
    });
    setState({ pending: { groupId: gid, base, cmd: cmd ?? { label: "", patches: [], inverse: [], at: Date.now() } } });
    setSongQuiet(next, { tid: result.trackId, cid: result.clipId ?? null });
    updateGroup(gid, { tried: i, kept: null });
    const t = audio().transport;
    if (!get().playing) {
      t.pos = sp.start * SPB;
      void play();
    } else {
      const step = t.frame();
      if (step < sp.start * SPB || step >= end * SPB) seek(sp.start * SPB);
    }
  } catch (e) {
    setState({ pending: null });
    setSongQuiet(base);
    updateGroup(gid, { tried: null });
    toast("Couldn't apply: " + errText(e));
  }
}
export function keepVariation(gid: string) {
  const s = get();
  if (s.pending?.groupId !== gid) return;
  const name = s.groups[gid]?.specs[s.groups[gid]?.tried ?? -1]?.name;
  if (s.pending.cmd.patches.length) settlePending();
  else {
    setState({ pending: null });
    updateGroup(gid, { kept: s.groups[gid]?.tried ?? null });
  }
  toast(`Kept “${name}”.`);
}
export function revertVariation(gid: string) {
  const s = get();
  if (s.pending?.groupId !== gid) return;
  const base = s.pending.base;
  setState({ pending: null });
  setSongQuiet(base);
  updateGroup(gid, { tried: null });
}
export type { VariationSpec, SoundKind };

// ---------- the sound maker and the user's library ----------
export const LIBRARY_KEY = "thk-studio-sounds-v1";
export function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    setState({ library: Array.isArray(list) ? (list as Sound[]).filter((s) => s && s.id && s.patch) : [] });
  } catch {
    /* no storage: the library is empty */
  }
}
/** Adds or updates the song's own sounds in the library (called whenever the song's sounds change). */
export function syncLibrary(sounds: Sound[] | undefined) {
  const fresh = (sounds ?? []).filter((s) => s.custom && s.patch);
  if (!fresh.length) return;
  const ids = new Set(fresh.map((s) => s.id));
  const library = [...get().library.filter((x) => !ids.has(x.id)), ...fresh.map((s) => ({ ...s, peaks: [] }))];
  setState({ library });
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch {
    /* storage full or blocked: the sound still lives in the song */
  }
}

/** Opens the sound maker on a new sound of a kind, or on a copy of an existing sound. */
export function openMaker(kind: SoundKind, from?: Sound) {
  const song = get().song;
  const patch = from ? startingPatch(song, from.kind, from.id) : instrumentPatch(kind);
  const isOwn = !!from?.custom;
  const name = from ? (isOwn ? from.name : `${from.name} copy`) : `My ${CAT[kind].one.toLowerCase()}`;
  const draft: Sound = {
    id: isOwn ? from!.id : "draft",
    kind: from?.kind ?? kind,
    name,
    note: "",
    hz: 0,
    dur: patch.length,
    peaks: [],
    patch,
    custom: true,
    ...(from?.family ? { family: from.family } : {}),
    ...(from?.description ? { description: from.description } : {}),
    ...(from?.recording ? { recording: from.recording } : {}),
    ...(from?.tags ? { tags: from.tags } : {}),
  };
  setState({ maker: { draft, isNew: !isOwn } });
}
export function updateDraft(p: Partial<Sound> & { patch?: Patch }) {
  const m = get().maker;
  if (m) setState({ maker: { ...m, draft: { ...m.draft, ...p, dur: (p.patch ?? m.draft.patch)!.length } } });
}
export function closeMaker() {
  setState({ maker: null });
  void audio().bank.loadSong(get().song); // drop any live preview of an edited sound
}

/**
 * Saves the draft into the song (one undo step) and the library. With `use`, also puts it on the
 * selected synth track or drum pad. Returns the saved sound's id.
 */
export function saveDraft(use: boolean): string | null {
  const m = get().maker;
  if (!m) return null;
  const { sel, song } = get();
  const id = m.isNew ? customSoundId(song, m.draft.name) : m.draft.id;
  const s: Sound = { ...m.draft, id, custom: true, peaks: [] };
  const tr = use ? trackById(song, sel.tid) : undefined;
  edit(m.isNew ? `New sound “${s.name}”` : `Edit sound “${s.name}”`, (d) => {
    saveSound(d, s);
    const t = tr && findIn(d, tr.id);
    if (t?.type === "synth") t.sample = id;
    else if (t?.type === "drums") t.pads[sel.row] = id;
  });
  setState({ maker: { draft: soundOf(get().song, id)!, isNew: false } });
  toast(
    tr
      ? `Saved “${s.name}” and put it on ${tr.name}${tr.type === "drums" ? ` pad ${sel.row + 1}` : ""}.`
      : `Saved “${s.name}” to this song and My sounds.`,
  );
  return id;
}
