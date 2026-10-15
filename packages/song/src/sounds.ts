// The song's own sounds: made in the sound maker or by the assistant, stored in song.sounds.
// Pure functions that mutate the song they are given, like pattern.ts.
import { BY_ID, CAT, KIT, MELODIC, soundOf } from "./kit.ts";
import { clamp, findTrack } from "./model.ts";
import { PatternError, resolvePad, resolveSound, type WriteResult } from "./pattern.ts";
import { clampPatch, instrumentPatch, INSTRUMENTS, type Patch } from "./patch.ts";
import type { Song, Sound, SoundKind } from "./types.ts";

const fail = (msg: string): never => {
  throw new PatternError(msg);
};

/** Id for a new sound, derived from its name so a replay of the same edits gives the same id. */
export function customSoundId(song: Song, name: string): string {
  const base =
    "user_" +
    (name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "sound");
  let id = base,
    n = 2;
  while (soundOf(song, id)) id = `${base}_${n++}`;
  return id;
}

/** The patch a new sound starts from: another patch sound, a kit sample to reshape, or the instrument's default. */
export function startingPatch(song: Song, kind: SoundKind, from?: unknown): Patch {
  if (from == null || from === "") return instrumentPatch(kind);
  const id = resolveSound(from, undefined, song);
  if (!id) return fail(`Unknown sound "${String(from)}" to start from. Use a sound id from the catalog.`);
  const s = soundOf(song, id)!;
  if (s.patch) return { ...s.patch };
  return clampPatch({ engine: "sample", source: id, attack: 0, decay: 0.5, sustain: 1, release: 0.02, length: Math.max(0.1, Math.min(6, s.dur)), cutoff: 20000, filterEnv: 0 }); // prettier-ignore
}

export interface SoundInput {
  name?: unknown;
  instrument?: unknown;
  start_from?: unknown;
  settings?: unknown;
  track?: unknown;
  pad?: unknown;
}

/** Adds a sound to the song, optionally putting it on a track (synth) or pad (drums). */
export function addSound(song: Song, i: SoundInput): WriteResult & { soundId: string } {
  const kind = String(i.instrument ?? "") as SoundKind;
  if (!INSTRUMENTS.some((x) => x.kind === kind))
    fail(`Unknown instrument "${String(i.instrument)}". Use one of: ${INSTRUMENTS.map((x) => x.kind).join(", ")}.`);
  const name =
    String(i.name ?? "")
      .trim()
      .slice(0, 40) || `My ${CAT[kind].one.toLowerCase()}`;
  const settings = (i.settings && typeof i.settings === "object" ? i.settings : {}) as Record<string, unknown>;
  const patch = clampPatch(settings, startingPatch(song, kind, i.start_from));
  const s: Sound = {
    id: customSoundId(song, name),
    kind,
    name,
    note: "",
    hz: 0,
    dur: patch.length,
    peaks: [],
    patch,
    custom: true,
  };
  (song.sounds ??= []).push(s);
  let where = "";
  if (i.track != null && i.track !== "") where = placeSound(song, s, i.track, i.pad);
  return {
    summary: `New ${CAT[kind].one.toLowerCase()} "${name}" (${s.id})${where}`,
    trackId: findTrack(song, i.track)?.id ?? "",
    soundId: s.id,
  };
}

/** Puts a sound on a synth track, or on a drum track's pad. */
function placeSound(song: Song, s: Sound, track: unknown, pad: unknown): string {
  const tr = findTrack(song, track);
  if (!tr) return fail(`No track "${String(track)}".`);
  if (tr.type === "synth") {
    tr.sample = s.id;
    return `, now on ${tr.name}`;
  }
  const p = pad ? clamp(Math.round(+(pad as number)), 1, 8) - 1 : resolvePad(tr, s.id, new Set(), song);
  tr.pads[p] = s.id;
  return `, now on ${tr.name} pad ${p + 1}`;
}

/** Changes one of the song's own sounds. Built-in sounds never change: start a new sound from them instead. */
export function editSound(song: Song, i: { sound?: unknown; settings?: unknown; rename?: unknown }): WriteResult {
  const ref = String(i.sound ?? "").trim(),
    low = ref.toLowerCase();
  const s = song.sounds?.find((x) => x.id === ref) ?? song.sounds?.find((x) => x.name.toLowerCase() === low);
  if (!s) {
    if (BY_ID[ref] || KIT.some((x) => x.name.toLowerCase() === low))
      return fail(
        `"${ref}" is a built-in sound and can't change. Use design_sound with start_from: "${ref}" to make an editable copy.`,
      );
    return fail(
      `No sound "${ref}" in this song. Its own sounds are: ${(song.sounds ?? []).map((x) => x.id).join(", ") || "none yet"}.`,
    );
  }
  const settings = (i.settings && typeof i.settings === "object" ? i.settings : {}) as Record<string, unknown>;
  s.patch = clampPatch(settings, s.patch);
  s.dur = s.patch.length;
  s.peaks = [];
  if (i.rename) s.name = String(i.rename).trim().slice(0, 40) || s.name;
  return { summary: `Changed "${s.name}": ${Object.keys(settings).join(", ") || "no settings"}`, trackId: "" };
}

/** Adds a sound from the sound maker, or replaces the song's sound with the same id. */
export function saveSound(song: Song, s: Sound): void {
  const list = (song.sounds ??= []);
  const at = list.findIndex((x) => x.id === s.id);
  const clean: Sound = {
    ...s,
    custom: true,
    dur: s.patch?.length ?? s.dur,
    patch: s.patch && clampPatch(s.patch as unknown as Record<string, unknown>, s.patch),
  };
  if (at >= 0) list[at] = clean;
  else list.push(clean);
}

/** True when a sound plays chromatically (synth tracks) rather than as a one-shot (drum pads). */
export const isMelodic = (kind: SoundKind) => MELODIC.has(kind);
