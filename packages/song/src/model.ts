import { ALIAS, DEFAULT_PADS, DEFAULT_SYNTH_SAMPLE, NOTE_NAMES } from "./kit.ts";
import type { Clip, DrumTrack, Note, Song, SynthTrack, Track, TrackType } from "./types.ts";

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const pname = (p: number) => NOTE_NAMES[((p % 12) + 12) % 12]! + (Math.floor(p / 12) - 1);

// ---------- ids and randomness (injectable so tests are deterministic) ----------
let idc = 0;
let makeId = () => Date.now().toString(36) + (idc++).toString(36) + Math.random().toString(36).slice(2, 5);
export const nid = () => makeId();
/** Replace the id generator (tests). Returns a function that restores the previous one. */
export function setIdGenerator(fn: () => string): () => void {
  const prev = makeId;
  makeId = fn;
  return () => {
    makeId = prev;
  };
}
/** Sequential ids "id1", "id2", ... for tests. */
export const sequentialIds = (prefix = "id") => {
  let n = 0;
  return () => prefix + ++n;
};
export type Random = () => number;

// ---------- constructors ----------
type TrackExtra = Partial<Omit<DrumTrack, "type">> & Partial<Omit<SynthTrack, "type">>;

export function makeTrack(type: "drums", name: string, extra?: TrackExtra): DrumTrack;
export function makeTrack(type: "synth", name: string, extra?: TrackExtra): SynthTrack;
export function makeTrack(type: TrackType, name: string, extra?: TrackExtra): Track;
export function makeTrack(type: TrackType, name: string, extra: TrackExtra = {}): Track {
  const base = {
    id: nid(),
    name,
    color: 0,
    vol: 0.8,
    pan: 0,
    cutoff: 20000,
    send: 0,
    mute: false,
    solo: false,
    clips: [],
  };
  if (type === "synth") {
    const { pads: _pads, ...rest } = extra;
    return { ...base, type, sample: DEFAULT_SYNTH_SAMPLE, mono: true, duck: true, ...rest };
  }
  const { sample: _s, mono: _m, duck: _d, ...rest } = extra;
  return { ...base, type, pads: [...DEFAULT_PADS], ...rest };
}

export const makeClip = (start: number, len: number, loop: number, notes: Note[] = [], name = ""): Clip => ({
  id: nid(),
  start,
  len,
  loop,
  notes,
  name,
});
export const N = (t: number, d: number, p: number, v = 1): Note => ({ t, d, p, v });
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

export function emptySong(): Song {
  return {
    v: 1,
    name: "Untitled song",
    bpm: 125,
    swing: 54,
    key: 5,
    loop: { on: false, start: 0, end: 4 },
    tracks: [makeTrack("drums", "Drums", { color: 0 }), makeTrack("synth", "Bass", { color: 2 })],
  };
}

/** "Late Shift": 32 bars in F at 125 BPM. Same notes as the prototype's demoSong(). */
export function demoSong(): Song {
  const kick = makeTrack("drums", "Kick", {
    color: 0,
    vol: 0.92,
    pads: ["THK_Kick_20_Big_Tech_F", ...DEFAULT_PADS.slice(1)],
  });
  const tops = makeTrack("drums", "Tops", { color: 1, vol: 0.62, send: 0.12 });
  const bass = makeTrack("synth", "Bass", { color: 2, vol: 0.78, sample: "THK_Bass_02_Rolling_Saw_Pluck_C" });
  const stab = makeTrack("synth", "Organ stab", {
    color: 3,
    vol: 0.5,
    send: 0.35,
    cutoff: 4200,
    mono: false,
    sample: "THK_Bass_06_Organ_M1_C",
  });

  const kickPat = [0, 4, 8, 12].map((t) => N(t, 1, 0));
  kick.clips.push(
    makeClip(0, 24, 1, clone(kickPat), "Four to the floor"),
    makeClip(28, 4, 1, clone(kickPat), "Four to the floor"),
  );

  const intro: Note[] = [];
  for (let s = 0; s < 16; s++) intro.push(N(s, 1, 4, s % 4 === 3 ? 0.75 : 0.4));
  [2, 6, 10, 14].forEach((s) => intro.push(N(s, 1, 3, 0.8)));
  const main: Note[] = [];
  for (let b = 0; b < 2; b++) {
    const o = b * 16;
    [4, 12].forEach((s) => main.push(N(o + s, 1, 1)));
    [2, 6, 10, 14].forEach((s) => main.push(N(o + s, 1, 3, 0.8)));
    for (let s = 0; s < 16; s++) if (s % 4 !== 2) main.push(N(o + s, 1, 2, s % 2 ? 0.7 : 0.45));
  }
  [7, 10, 23, 29].forEach((s) => main.push(N(s, 1, 5, 0.7)));
  main.push(N(30, 1, 7, 0.6), N(31, 1, 7, 0.85));
  const brk: Note[] = [];
  for (let b = 0; b < 3; b++) [4, 12].forEach((s) => brk.push(N(b * 16 + s, 1, 1)));
  for (let s = 0; s < 64; s++) brk.push(N(s, 1, 4, s % 4 === 3 ? 0.7 : 0.38));
  brk.push(N(40, 1, 6, 0.5), N(44, 1, 6, 0.55));
  [48, 52, 56, 58, 60, 61, 62, 63].forEach((s, i) => brk.push(N(s, 1, 6, 0.55 + i * 0.06)));
  tops.clips.push(
    makeClip(0, 8, 1, intro, "Shaker intro"),
    makeClip(8, 16, 2, clone(main), "Main groove"),
    makeClip(24, 4, 4, brk, "Break + roll"),
    makeClip(28, 4, 2, clone(main), "Main groove"),
  );

  const bassPat = (
    [
      [2, 1, 41],
      [3, 1, 41],
      [6, 2, 41],
      [10, 1, 41],
      [11, 1, 53],
      [14, 2, 44],
      [18, 1, 41],
      [19, 1, 41],
      [22, 2, 41],
      [26, 1, 41],
      [27, 1, 39],
      [30, 2, 48],
    ] as const
  ).map(([t, d, p]) => N(t, d, p));
  bass.clips.push(makeClip(8, 16, 2, clone(bassPat), "Rolling F"), makeClip(28, 4, 2, clone(bassPat), "Rolling F"));

  const stabPat: Note[] = [];
  const chord = (t: number, ps: number[], d = 2) => ps.forEach((p) => stabPat.push(N(t, d, p, 0.9)));
  chord(6, [53, 56, 60]);
  chord(30, [53, 56, 60]);
  chord(38, [51, 55, 58]);
  chord(58, [53, 56, 60], 3);
  stab.clips.push(makeClip(16, 12, 4, stabPat, "Fm stabs"), makeClip(28, 4, 4, clone(stabPat), "Fm stabs"));

  return {
    v: 1,
    name: "Late Shift (demo)",
    bpm: 125,
    swing: 54,
    key: 5,
    loop: { on: false, start: 8, end: 16 },
    tracks: [kick, tops, bass, stab],
  };
}

// ---------- loading ----------
export const validSong = (s: unknown): s is Song =>
  !!s && typeof s === "object" && Array.isArray((s as Song).tracks) && typeof (s as Song).bpm === "number";

/** Brings a saved song up to date: default key, sound ids renamed through the alias map. */
export function migrate<T>(s: T): T {
  if (!validSong(s)) return s;
  if (typeof s.key !== "number") s.key = 5;
  for (const t of s.tracks) {
    if (t.type === "drums" && t.pads) t.pads = t.pads.map((p) => (p && ALIAS[p]) || p);
    if (t.type === "synth" && t.sample) t.sample = ALIAS[t.sample] || t.sample;
  }
  return s;
}

// ---------- queries ----------
export function songEnd(song: Song): number {
  let e = 0;
  for (const t of song.tracks) for (const c of t.clips) e = Math.max(e, c.start + c.len);
  return e;
}
export const displayBars = (song: Song) => Math.max(48, Math.ceil((songEnd(song) + 16) / 4) * 4);
export const trackById = (song: Song, id: string | null | undefined) => song.tracks.find((t) => t.id === id);
export const clipById = (tr: Track | undefined, id: string | null | undefined) => tr?.clips.find((c) => c.id === id);
export const overlaps = (tr: Track, c: Clip) =>
  tr.clips.some((o) => o.id !== c.id && o.start < c.start + c.len && c.start < o.start + o.len);
/** A track by id, or by name (case-insensitive). */
export function findTrack(song: Song, ref: unknown): Track | undefined {
  if (ref == null) return undefined;
  const raw = String(ref).trim(),
    r = raw.toLowerCase();
  return song.tracks.find((t) => t.id === raw) ?? song.tracks.find((t) => t.name.toLowerCase() === r);
}
export const anySolo = (song: Song) => song.tracks.some((t) => t.solo);
export const audible = (song: Song, tr: Track) => !tr.mute && (!anySolo(song) || tr.solo);
