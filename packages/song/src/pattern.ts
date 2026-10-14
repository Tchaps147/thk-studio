// Writing patterns: shared by grooves, variations and the assistant (HANDOFF.md 4.5).
// Every function here mutates the song it is given (an Immer draft in the app, a plain copy on
// the server) and throws PatternError with user-facing text when the request can't be applied.
import { ALIAS, BY_ID, CAT, CAT_DEFAULT, FMAX, FMIN, HIGH, KIT, LOW, NOTE_NAMES, SPB } from "./kit.ts";
import { N, clamp, findTrack, makeClip, makeTrack, nid } from "./model.ts";
import type { Clip, DrumTrack, Note, Song, SoundKind, SynthTrack, Track, TrackType } from "./types.ts";

export class PatternError extends Error {
  override name = "PatternError";
}
const fail = (msg: string): never => {
  throw new PatternError(msg);
};

/** Result of a write: summary text plus where it landed, so callers can select it. */
export interface WriteResult {
  summary: string;
  trackId: string;
  clipId?: string;
}

// ---------- sounds and pads ----------
const SYN: Record<string, SoundKind> = {
  kick: "kick", kicks: "kick", bd: "kick", "bass drum": "kick",
  clap: "clap", claps: "clap",
  snare: "snare", snares: "snare", sd: "snare",
  "closed hat": "hat_closed", "closed hats": "hat_closed", "hat closed": "hat_closed", hat: "hat_closed", hats: "hat_closed",
  hihat: "hat_closed", hihats: "hat_closed", "hi hat": "hat_closed", "hi hats": "hat_closed", ch: "hat_closed",
  "open hat": "hat_open", "open hats": "hat_open", "hat open": "hat_open", oh: "hat_open",
  ride: "ride", rides: "ride", cymbal: "ride",
  shaker: "shaker", shakers: "shaker", tambourine: "shaker",
  rim: "rim", rims: "rim", rimshot: "rim", "rim shot": "rim", clave: "rim",
  perc: "perc", percussion: "perc", conga: "perc", congas: "perc", bongo: "perc", bongos: "perc", cowbell: "perc",
  tom: "tom", toms: "tom",
}; // prettier-ignore

/** A drum category from loose text ("Hi hats", "open_hat"), or null. */
export const normCat = (spec: unknown): SoundKind | null =>
  SYN[
    String(spec ?? "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .trim()
  ] ?? null;

/** A sound id from an id, an old alias, a name or a unique-enough part of a name. */
export function resolveSound(spec: unknown, kind?: SoundKind): string | null {
  const r = String(spec ?? "").trim();
  if (BY_ID[r]) return r;
  if (ALIAS[r]) return ALIAS[r];
  const low = r.toLowerCase(),
    pool = KIT.filter((s) => !kind || s.kind === kind);
  const hit =
    pool.find((s) => s.id.toLowerCase() === low) ??
    pool.find((s) => s.name.toLowerCase() === low) ??
    pool.find((s) => (CAT[s.kind].one + " " + s.name).toLowerCase() === low) ??
    (low.length >= 3 ? pool.find((s) => s.name.toLowerCase().includes(low)) : undefined);
  return hit ? hit.id : null;
}

export function padsInUse(tr: Track): Set<number> {
  const u = new Set<number>();
  tr.clips.forEach((c) => c.notes.forEach((n) => u.add(n.p)));
  return u;
}

/**
 * Maps a sound or category to a pad: an existing pad with that id, else a pad of the same
 * category (re-pointed at the id if one was given), else an empty pad, else a pad no note uses.
 * Never steals a pad in `taken` or one that notes play.
 */
export function resolvePad(tr: DrumTrack, spec: unknown, taken: Set<number>): number {
  const s = String(spec ?? "");
  let id: string | null = BY_ID[s] ? s : (ALIAS[s] ?? null);
  let cat: SoundKind | null = id ? BY_ID[id]!.kind : normCat(spec);
  if (!id && !cat) {
    id = resolveSound(spec);
    if (id) cat = BY_ID[id]!.kind;
  }
  if (!cat)
    return fail(
      `Unknown drum sound "${s}". Use a category (kick, clap, snare, closed hat, open hat, ride, shaker, rim, perc, tom) or a sound id.`,
    );
  if (id) {
    const at = tr.pads.indexOf(id);
    if (at >= 0 && !taken.has(at)) return at;
  }
  const same = tr.pads.findIndex((p, i) => !taken.has(i) && !!p && BY_ID[p]?.kind === cat);
  if (same >= 0) {
    if (id) tr.pads[same] = id;
    return same;
  }
  const used = padsInUse(tr);
  let free = tr.pads.findIndex((p, i) => !taken.has(i) && !p);
  if (free < 0) free = tr.pads.findIndex((_p, i) => !taken.has(i) && !used.has(i));
  if (free < 0)
    return fail(`All 8 pads on "${tr.name}" are in use. Put the ${CAT[cat].one.toLowerCase()} on another drum track.`);
  tr.pads[free] = id ?? CAT_DEFAULT[cat];
  return free;
}

// ---------- clips ----------
/** A clip's notes as heard from `offset` steps into the clip, for a window of L steps. */
export function tile(c: Clip, offset: number, L: number): Note[] {
  const CLn = c.loop * SPB,
    out: Note[] = [];
  for (const n of c.notes) {
    if (n.t >= CLn) continue;
    for (let q = n.t + Math.floor((offset - n.t) / CLn) * CLn; q < offset + L; q += CLn)
      if (q >= offset) out.push({ ...n, t: q - offset, d: Math.min(n.d, offset + L - q) });
  }
  return out;
}

/**
 * Removes bars [a, b) from a track. Clips starting before a are shortened; clips running past b
 * are split and the right-hand piece is re-phased with tile() so it sounds exactly as before.
 */
export function carve(tr: Track, a: number, b: number): void {
  const keep: Clip[] = [];
  for (const c of tr.clips) {
    const ce = c.start + c.len;
    if (ce <= a || c.start >= b) {
      keep.push(c);
      continue;
    }
    if (c.start < a) keep.push({ ...c, len: a - c.start });
    if (ce > b)
      keep.push({ ...c, id: nid(), start: b, len: ce - b, notes: tile(c, (b - c.start) * SPB, c.loop * SPB) });
  }
  tr.clips = keep;
}

/**
 * Replaces whatever the track had in [start, start+len) with one new clip. makeNotes receives
 * the notes previously audible at `start`, re-tiled to the new pattern length, so callers can merge.
 * An exact replacement keeps the old clip's id and name.
 */
export function writeClip(
  tr: Track,
  start: number,
  len: number,
  loop: number,
  makeNotes: (base: Note[]) => Note[],
  name?: string,
): Clip {
  const L = loop * SPB,
    cover = tr.clips.find((c) => c.start <= start && start < c.start + c.len);
  const base = cover ? tile(cover, (start - cover.start) * SPB, L) : [];
  const exact = cover && cover.start === start && cover.len === len ? { id: cover.id, name: cover.name } : null;
  carve(tr, start, start + len);
  const c = makeClip(start, len, loop, makeNotes(base), name || exact?.name || "");
  if (exact) c.id = exact.id;
  tr.clips.push(c);
  tr.clips.sort((x, y) => x.start - y.start);
  return c;
}

// ---------- parsing ----------
/** Step string -> [step, velocity] hits. x hit, o soft, - or . rest; spaces and | ignored; shorter strings tile. */
export function parseSteps(str: unknown, L: number): [number, number][] {
  const s = String(str ?? "").replace(/[\s|]+/g, "");
  if (!s || /[^xXoO.\-_]/.test(s))
    return fail(`Bad steps "${String(str).slice(0, 40)}". Use x (hit), o (soft) and - (rest).`);
  const out: [number, number][] = [];
  for (let i = 0; i < L; i++) {
    const ch = s[i % s.length];
    if (ch === "x" || ch === "X") out.push([i, 1]);
    else if (ch === "o" || ch === "O") out.push([i, 0.55]);
  }
  return out;
}

/** "F2", "C#3", "Bb1" or a MIDI number -> MIDI pitch (C4 = 60). */
export function parseNote(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return Math.round(v);
  const m = /^\s*([A-Ga-g])([#b]?)(-?\d)\s*$/.exec(String(v));
  if (!m) return fail(`Bad note "${String(v)}". Use names like F2 or C#3.`);
  let pc = NOTE_NAMES.indexOf(m[1]!.toUpperCase() as (typeof NOTE_NAMES)[number]);
  if (m[2] === "#") pc++;
  if (m[2] === "b") pc--;
  return 12 * (+m[3]! + 1) + pc;
}

/** Pitch class 0-11 from a key name like "F", "F#" or "Bb". */
export function parseKey(v: unknown): number {
  const m = /^\s*([A-Ga-g])([#b]?)/.exec(String(v));
  if (!m) return fail(`Bad key "${String(v)}".`);
  let pc = NOTE_NAMES.indexOf(m[1]!.toUpperCase() as (typeof NOTE_NAMES)[number]);
  if (m[2] === "#") pc++;
  if (m[2] === "b") pc--;
  return (pc + 12) % 12;
}

export interface RangeSpec {
  start?: unknown;
  len?: unknown;
  loop?: unknown;
}
export function rangeOf(sp: RangeSpec) {
  const start = Math.max(0, Math.round(+(sp.start as number) || 0)),
    loop = clamp(Math.round(+(sp.loop as number) || 1), 1, 16),
    len = clamp(Math.round(+(sp.len as number) || loop), 1, 512);
  return { start, len, loop, L: loop * SPB };
}

// ---------- tracks ----------
export function ensureTrack(song: Song, ref: unknown, type: "drums"): DrumTrack;
export function ensureTrack(song: Song, ref: unknown, type: "synth"): SynthTrack;
export function ensureTrack(song: Song, ref: unknown, type: TrackType): Track {
  let tr = findTrack(song, ref);
  if (!tr) {
    tr = makeTrack(type, String(ref || (type === "drums" ? "Drums" : "Synth")).slice(0, 40), {
      color: song.tracks.length % 6,
    });
    song.tracks.push(tr);
  } else if (tr.type !== type) {
    const word = (t: TrackType) => (t === "drums" ? "drum" : "synth");
    fail(`"${tr.name}" is a ${word(tr.type)} track, not a ${word(type)} track.`);
  }
  return tr;
}

// ---------- writers ----------
export interface DrumLane {
  sound: unknown;
  steps: unknown;
}
export interface DrumSpec extends RangeSpec {
  track: unknown;
  lanes: unknown;
  replace?: boolean;
  name?: string;
}
/** Writes drum lanes as one clip. Lanes not listed are kept unless replace is true. */
export function writeDrums(song: Song, sp: DrumSpec): WriteResult {
  const tr = ensureTrack(song, sp.track, "drums"),
    { start, len, loop, L } = rangeOf(sp);
  if (!Array.isArray(sp.lanes) || !sp.lanes.length) fail("lanes is empty.");
  const taken = new Set<number>(),
    lanes: { pad: number; hits: [number, number][] }[] = [];
  for (const l of sp.lanes as DrumLane[]) {
    const hits = parseSteps(l?.steps, L),
      pad = resolvePad(tr, l?.sound, taken);
    taken.add(pad);
    lanes.push({ pad, hits });
  }
  const c = writeClip(
    tr,
    start,
    len,
    loop,
    (base) =>
      (sp.replace ? [] : base.filter((n) => !taken.has(n.p))).concat(
        ...lanes.map((l) => l.hits.map(([t, v]) => N(t, 1, l.pad, v))),
      ),
    sp.name,
  );
  const summary =
    `${tr.name} bars ${start + 1}–${start + len} (${loop}-bar pattern): ` +
    lanes
      .map((l) => {
        const s = BY_ID[tr.pads[l.pad]!]!;
        return `${CAT[s.kind].one.toLowerCase()} ${s.name} ×${l.hits.length}`;
      })
      .join(", ");
  return { summary, trackId: tr.id, clipId: c.id };
}

export interface NoteInput {
  step?: unknown;
  note?: unknown;
  len?: unknown;
  soft?: unknown;
}
export interface NoteSpec extends RangeSpec {
  track: unknown;
  notes: unknown;
  sound?: unknown;
  name?: string;
}
/** Writes a note pattern as one clip, optionally setting the track's sound. */
export function writeNotes(song: Song, sp: NoteSpec): WriteResult {
  const tr = ensureTrack(song, sp.track, "synth"),
    { start, len, loop, L } = rangeOf(sp);
  if (sp.sound) {
    const id = resolveSound(sp.sound);
    if (!id) fail(`Unknown sound "${String(sp.sound)}". Use an id from the catalog.`);
    tr.sample = id!;
  }
  if (!Array.isArray(sp.notes)) fail("notes must be a list.");
  const notes = (sp.notes as NoteInput[]).map((n) =>
    N(
      clamp(Math.round(+(n.step as number) || 0), 0, L - 1),
      clamp(Math.round(+(n.len as number) || 1), 1, L),
      clamp(parseNote(n.note), LOW, HIGH),
      n.soft ? 0.55 : 1,
    ),
  );
  const c = writeClip(tr, start, len, loop, () => notes, sp.name);
  return {
    summary: `${tr.name} bars ${start + 1}–${start + len} (${loop}-bar pattern): ${notes.length} notes, ${BY_ID[tr.sample]?.name ?? "?"}`,
    trackId: tr.id,
    clipId: c.id,
  };
}

export interface TrackInput {
  track?: unknown;
  create?: unknown;
  rename?: unknown;
  sound?: unknown;
  pad?: unknown;
  volume?: unknown;
  mute?: unknown;
  solo?: unknown;
  filter_hz?: unknown;
  reverb?: unknown;
  pan?: unknown;
  duck?: unknown;
  mono?: unknown;
}
/** Creates or changes a track: sound, pad sound, mix and flags. */
export function setTrack(song: Song, i: TrackInput): WriteResult {
  let tr = findTrack(song, i.track);
  if (!tr) {
    if (!i.create) fail(`No track "${String(i.track)}". Pass create: "drums" or "synth" to make one.`);
    tr = i.create === "synth" ? ensureTrack(song, i.track, "synth") : ensureTrack(song, i.track, "drums");
  }
  const did: string[] = [];
  if (i.rename) {
    tr.name = String(i.rename).slice(0, 40);
    did.push("renamed");
  }
  if (i.sound != null && i.sound !== "") {
    const id = resolveSound(i.sound);
    if (!id) fail(`Unknown sound "${String(i.sound)}". Use an id from the catalog.`);
    const name = BY_ID[id!]!.name;
    if (tr.type === "synth") {
      tr.sample = id!;
      did.push("sound " + name);
    } else if (i.pad) {
      const p = clamp(Math.round(+(i.pad as number)), 1, 8) - 1;
      tr.pads[p] = id;
      did.push(`pad ${p + 1} ${name}`);
    } else {
      const p = resolvePad(tr, id, new Set());
      did.push(`pad ${p + 1} ${name}`);
    }
  }
  if (i.volume != null) {
    tr.vol = clamp(+(i.volume as number), 0, 1);
    did.push("volume " + tr.vol.toFixed(2));
  }
  if (i.mute != null) {
    tr.mute = !!i.mute;
    did.push(tr.mute ? "muted" : "unmuted");
  }
  if (i.solo != null) {
    tr.solo = !!i.solo;
    did.push(tr.solo ? "solo on" : "solo off");
  }
  if (i.filter_hz != null) {
    tr.cutoff = clamp(Math.round(+(i.filter_hz as number)), FMIN, FMAX);
    did.push("filter " + tr.cutoff + " Hz");
  }
  if (i.reverb != null) {
    tr.send = clamp(+(i.reverb as number), 0, 1);
    did.push("reverb " + Math.round(tr.send * 100) + "%");
  }
  if (i.pan != null) {
    tr.pan = clamp(+(i.pan as number), -1, 1);
    did.push("pan " + tr.pan);
  }
  if (i.duck != null && tr.type === "synth") {
    tr.duck = !!i.duck;
    did.push(tr.duck ? "ducks to kick" : "no ducking");
  }
  if (i.mono != null && tr.type === "synth") {
    tr.mono = !!i.mono;
    did.push(tr.mono ? "mono" : "poly");
  }
  return { summary: `${tr.name}: ${did.join(", ") || "created"}`, trackId: tr.id };
}

export interface SongInput {
  bpm?: unknown;
  key?: unknown;
  swing?: unknown;
  name?: unknown;
}
export function setSong(song: Song, i: SongInput): string {
  const did: string[] = [];
  if (i.bpm != null) {
    song.bpm = clamp(Math.round(+(i.bpm as number)) || 125, 80, 170);
    did.push(song.bpm + " BPM");
  }
  if (i.key != null) {
    song.key = parseKey(i.key);
    did.push("key " + NOTE_NAMES[song.key]);
  }
  if (i.swing != null) {
    song.swing = clamp(Math.round(+(i.swing as number)), 50, 66);
    did.push("swing " + song.swing + "%");
  }
  if (i.name) {
    song.name = String(i.name).slice(0, 80);
    did.push("renamed");
  }
  return "Song: " + (did.join(", ") || "no change");
}

/** Clears bars [fromBar, toBar] (1-based, inclusive) on a track, splitting clips at the edges. */
export function deleteBars(song: Song, track: unknown, fromBar: unknown, toBar: unknown): string {
  const tr = findTrack(song, track);
  if (!tr) return fail(`No track "${String(track)}".`);
  const a = (+(fromBar as number) || 1) - 1,
    b = Math.max(a + 1, +(toBar as number) || a + 1);
  carve(tr, a, b);
  return `Cleared ${tr.name} bars ${a + 1}–${b}`;
}

/** A drum clip's lanes as step strings, one per pad that plays. */
export function lanesOf(c: Clip): { pad: number; steps: string }[] {
  const L = c.loop * SPB,
    m: Record<number, string[]> = {};
  for (const n of c.notes) {
    if (n.t >= L) continue;
    (m[n.p] ??= Array<string>(L).fill("-"))[n.t] = n.v >= 0.8 ? "x" : "o";
  }
  return Object.entries(m).map(([p, a]) => ({ pad: +p, steps: a.join("") }));
}
