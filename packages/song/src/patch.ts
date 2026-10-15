// Sound patches: a sound described as synth settings instead of a recording. Patches render to
// a sample in the browser (packages/audio/src/synth.ts), so tracks play them exactly like kit
// sounds: rooted on C2 and played chromatically, one-shot on drum pads. The parameter table below
// drives clamping, the sound maker's knobs and the assistant's design_sound / edit_sound tools.
import type { SoundKind } from "./types.ts";

export const WAVES = ["sine", "triangle", "saw", "square"] as const;
export type Wave = (typeof WAVES)[number];
export const FILTER_TYPES = ["lowpass", "highpass", "bandpass"] as const;
export type FilterType = (typeof FILTER_TYPES)[number];
export const CHORD_VOICINGS = {
  none: [0],
  major: [0, 4, 7],
  minor: [0, 3, 7],
  minor7: [0, 3, 7, 10],
  major7: [0, 4, 7, 11],
  dominant7: [0, 4, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  minor9: [0, 3, 7, 10, 14],
  major9: [0, 4, 7, 11, 14],
  dominant9: [0, 4, 7, 10, 14],
  minor11: [0, 3, 7, 10, 14, 17],
  major6: [0, 4, 7, 9],
  minor6: [0, 3, 7, 9],
  major_open: [0, 7, 16],
  minor_open: [0, 7, 15],
} as const;
export const CHORD_LABELS: Record<keyof typeof CHORD_VOICINGS, string> = {
  none: "Single note", major: "Major", minor: "Minor", minor7: "Minor 7th", major7: "Major 7th",
  dominant7: "Dominant 7th", sus2: "Suspended 2nd", sus4: "Suspended 4th", minor9: "Minor 9th",
  major9: "Major 9th", dominant9: "Dominant 9th", minor11: "Minor 11th", major6: "Major 6th",
  minor6: "Minor 6th", major_open: "Open major", minor_open: "Open minor",
}; // prettier-ignore
export const VOWELS = ["off", "ah", "eh", "ee", "oh", "oo"] as const;

export interface Patch {
  /** "synth": oscillators. "sample": an existing kit sound reshaped. */
  engine: "synth" | "sample";
  /** Sample engine: the kit sound to start from. */
  source?: string;
  osc1Wave: Wave;
  osc1Level: number;
  osc2Wave: Wave;
  osc2Level: number;
  osc2Semi: number;
  osc2Detune: number;
  unison: number;
  spread: number;
  sub: number;
  noise: number;
  fmRatio: number;
  fmAmount: number;
  /** Optional FM attack decay; missing or zero preserves constant-depth legacy synthesis. */
  fmDecay?: number;
  tune: number;
  pitchEnv: number;
  pitchDecay: number;
  filterType: FilterType;
  cutoff: number;
  resonance: number;
  filterEnv: number;
  filterAttack: number;
  filterDecay: number;
  filterSustain: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  length: number;
  drive: number;
  /** Sample engine: play from/to this fraction of the source, optionally reversed. */
  start: number;
  end: number;
  reverse: boolean;
  /** Optional for compatibility with sounds saved before chord/vowel synthesis. */
  chord?: keyof typeof CHORD_VOICINGS;
  vowel?: (typeof VOWELS)[number];
}

export type ParamGroup = "Source" | "Pitch" | "Filter" | "Amp" | "Character" | "Sample";
interface NumParam {
  key: keyof Patch;
  label: string;
  group: ParamGroup;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Knob moves on a log scale (frequencies, times). */
  log?: boolean;
  int?: boolean;
  help: string;
  engines: ("synth" | "sample")[];
}
interface EnumParam {
  key: keyof Patch;
  label: string;
  group: ParamGroup;
  options: readonly string[];
  help: string;
  engines: ("synth" | "sample")[];
}
interface BoolParam {
  key: keyof Patch;
  label: string;
  group: ParamGroup;
  bool: true;
  help: string;
  engines: ("synth" | "sample")[];
}
export type Param = NumParam | EnumParam | BoolParam;
export const isEnum = (p: Param): p is EnumParam => "options" in p;
export const isBool = (p: Param): p is BoolParam => "bool" in p;

const S = ["synth"] as ("synth" | "sample")[],
  B = ["synth", "sample"] as ("synth" | "sample")[],
  SM = ["sample"] as ("synth" | "sample")[];

/** Every knob, with its range. Order is the order the sound maker shows them. */
export const PARAMS: readonly Param[] = [
  { key: "osc1Wave", label: "Osc 1", group: "Source", options: WAVES, help: "First oscillator's waveform.", engines: S },
  { key: "osc1Level", label: "Osc 1 level", group: "Source", min: 0, max: 1, step: 0.01, help: "First oscillator's volume.", engines: S },
  { key: "osc2Wave", label: "Osc 2", group: "Source", options: WAVES, help: "Second oscillator's waveform.", engines: S },
  { key: "osc2Level", label: "Osc 2 level", group: "Source", min: 0, max: 1, step: 0.01, help: "Second oscillator's volume (0 = off).", engines: S },
  { key: "osc2Semi", label: "Osc 2 pitch", group: "Source", min: -24, max: 24, step: 1, int: true, unit: "st", help: "Second oscillator's offset in semitones (12 = an octave up, 7 = a fifth).", engines: S },
  { key: "osc2Detune", label: "Osc 2 detune", group: "Source", min: -50, max: 50, step: 1, unit: "ct", help: "Fine detune of the second oscillator in cents; a few cents thickens the sound.", engines: S },
  { key: "unison", label: "Unison", group: "Source", min: 1, max: 7, step: 1, int: true, help: "Copies of each oscillator, spread in pitch, for a wide supersaw-style sound.", engines: S },
  { key: "spread", label: "Spread", group: "Source", min: 0, max: 60, step: 1, unit: "ct", help: "How far apart the unison copies are detuned, in cents.", engines: S },
  { key: "sub", label: "Sub", group: "Source", min: 0, max: 1, step: 0.01, help: "Sine one octave below: weight for basses.", engines: S },
  { key: "noise", label: "Noise", group: "Source", min: 0, max: 1, step: 0.01, help: "White noise: hats, claps, snares, risers, breath.", engines: S },
  { key: "fmRatio", label: "FM ratio", group: "Source", min: 0.5, max: 16, step: 0.5, help: "Frequency ratio of the FM modulator (1, 2, 3.5 ... ).", engines: S },
  { key: "fmAmount", label: "FM amount", group: "Source", min: 0, max: 20, step: 0.1, help: "FM depth: 0 off, 1-3 bells and electric pianos, higher for metallic growls.", engines: S },
  { key: "fmDecay", label: "FM attack decay", group: "Source", min: 0, max: 2, step: 0.005, unit: "s", help: "Fade the metallic FM attack into a rounded tone. Zero keeps constant FM depth.", engines: S },
  { key: "chord", label: "Chord voicing", group: "Source", options: Object.keys(CHORD_VOICINGS), help: "Play a full chord from each note. None keeps the original single-note sound.", engines: S },
  { key: "vowel", label: "Vowel", group: "Character", options: VOWELS, help: "Shape the sound with vocal formants: Ah, Eh, Ee, Oh or Oo. Off keeps the original tone.", engines: S },
  { key: "source", label: "Source sound", group: "Sample", options: [], help: "Sample engine: id of the kit sound to reshape.", engines: SM },
  { key: "start", label: "Start", group: "Sample", min: 0, max: 0.95, step: 0.01, help: "Sample engine: where playback starts, as a fraction of the source.", engines: SM },
  { key: "end", label: "End", group: "Sample", min: 0.05, max: 1, step: 0.01, help: "Sample engine: where playback ends, as a fraction of the source.", engines: SM },
  { key: "reverse", label: "Reverse", group: "Sample", bool: true, help: "Sample engine: play the source backwards.", engines: SM },
  { key: "tune", label: "Tune", group: "Pitch", min: -24, max: 24, step: 1, int: true, unit: "st", help: "Overall pitch in semitones.", engines: B },
  { key: "pitchEnv", label: "Pitch drop", group: "Pitch", min: 0, max: 48, step: 1, unit: "st", help: "Start this many semitones higher and sweep down: kicks, toms, zaps.", engines: B },
  { key: "pitchDecay", label: "Drop time", group: "Pitch", min: 0.005, max: 1, step: 0.005, log: true, unit: "s", help: "How long the pitch drop takes.", engines: B },
  { key: "filterType", label: "Filter", group: "Filter", options: FILTER_TYPES, help: "Lowpass darkens, highpass thins, bandpass narrows.", engines: B },
  { key: "cutoff", label: "Cutoff", group: "Filter", min: 30, max: 20000, step: 1, log: true, unit: "Hz", help: "Filter frequency: lower is darker for a lowpass.", engines: B },
  { key: "resonance", label: "Resonance", group: "Filter", min: 0.1, max: 20, step: 0.1, log: true, help: "Peak at the cutoff: 0.7 neutral, 8+ squelchy acid.", engines: B },
  { key: "filterEnv", label: "Filter env", group: "Filter", min: -4, max: 8, step: 0.1, unit: "oct", help: "How many octaves the envelope opens the filter: the 'pluck' or 'wow'.", engines: B },
  { key: "filterAttack", label: "Filter attack", group: "Filter", min: 0, max: 2, step: 0.001, log: true, unit: "s", help: "Filter envelope attack.", engines: B },
  { key: "filterDecay", label: "Filter decay", group: "Filter", min: 0.005, max: 4, step: 0.005, log: true, unit: "s", help: "Filter envelope decay: short for plucks, long for sweeps.", engines: B },
  { key: "filterSustain", label: "Filter sustain", group: "Filter", min: 0, max: 1, step: 0.01, help: "Filter envelope level while held.", engines: B },
  { key: "attack", label: "Attack", group: "Amp", min: 0, max: 2, step: 0.001, log: true, unit: "s", help: "Fade-in time: 0 for punch, longer for pads and swells.", engines: B },
  { key: "decay", label: "Decay", group: "Amp", min: 0.005, max: 4, step: 0.005, log: true, unit: "s", help: "Time to fall to the sustain level.", engines: B },
  { key: "sustain", label: "Sustain", group: "Amp", min: 0, max: 1, step: 0.01, help: "Level while the sound is held (0 = one-shot hit).", engines: B },
  { key: "release", label: "Release", group: "Amp", min: 0.005, max: 4, step: 0.005, log: true, unit: "s", help: "Fade-out at the end of the sound.", engines: B },
  { key: "length", label: "Length", group: "Amp", min: 0.05, max: 6, step: 0.01, log: true, unit: "s", help: "Total length of the rendered sound. Notes shorter than this are cut with a short release.", engines: B },
  { key: "drive", label: "Drive", group: "Character", min: 0, max: 1, step: 0.01, help: "Saturation: warmth at low values, grit and distortion at high values.", engines: B },
]; // prettier-ignore

export const BASE_PATCH: Patch = {
  engine: "synth",
  osc1Wave: "saw", osc1Level: 0.8, osc2Wave: "saw", osc2Level: 0, osc2Semi: 0, osc2Detune: 0, unison: 1, spread: 15,
  sub: 0, noise: 0, fmRatio: 1, fmAmount: 0, tune: 0, pitchEnv: 0, pitchDecay: 0.05,
  filterType: "lowpass", cutoff: 4000, resonance: 0.7, filterEnv: 0, filterAttack: 0, filterDecay: 0.3, filterSustain: 0,
  attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.08, length: 1, drive: 0, start: 0, end: 1, reverse: false,
}; // prettier-ignore

const clampNum = (v: unknown, p: NumParam, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!isFinite(n)) return fallback;
  const c = Math.max(p.min, Math.min(p.max, n));
  return p.int ? Math.round(c) : c;
};

/** Merges settings onto a base patch, clamping every value to its range and dropping unknown keys. */
export function clampPatch(input: Record<string, unknown> | Partial<Patch>, base: Patch = BASE_PATCH): Patch {
  const out: Patch = { ...base };
  const src = input as Record<string, unknown>;
  if (src.engine === "synth" || src.engine === "sample") out.engine = src.engine;
  if (typeof src.source === "string") out.source = src.source;
  for (const p of PARAMS) {
    if (!(p.key in src) || p.key === "source") continue;
    const v = src[p.key];
    if (isEnum(p)) {
      if (typeof v === "string" && p.options.includes(v)) (out as unknown as Record<string, unknown>)[p.key] = v;
    } else if (isBool(p)) (out as unknown as Record<string, unknown>)[p.key] = !!v;
    else (out as unknown as Record<string, number>)[p.key] = clampNum(v, p, base[p.key] as number);
  }
  if (out.end <= out.start + 0.02) out.end = Math.min(1, out.start + 0.05);
  return out;
}

/** Stable short hash of a patch: renders are cached by it. */
export function patchHash(p: Patch): string {
  const s = JSON.stringify(
    Object.keys(p)
      .sort()
      .map((k) => [k, (p as unknown as Record<string, unknown>)[k]]),
  );
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** What the sound maker offers, and where each instrument's sound can go. */
export const INSTRUMENTS: readonly { kind: SoundKind; label: string; melodic: boolean }[] = [
  { kind: "bass", label: "Bass", melodic: true },
  { kind: "lead", label: "Lead", melodic: true },
  { kind: "pad", label: "Pad", melodic: true },
  { kind: "stab", label: "Stab / chord", melodic: true },
  { kind: "pluck", label: "Pluck", melodic: true },
  { kind: "piano", label: "Piano", melodic: true },
  { kind: "electric_piano", label: "Electric piano", melodic: true },
  { kind: "organ", label: "Organ", melodic: true },
  { kind: "chord", label: "Chord", melodic: true },
  { kind: "strings", label: "Strings", melodic: true },
  { kind: "brass", label: "Brass", melodic: true },
  { kind: "guitar", label: "Guitar", melodic: true },
  { kind: "mallet", label: "Bell / mallet", melodic: true },
  { kind: "vocal", label: "Vocal", melodic: true },
  { kind: "atmosphere", label: "Atmosphere", melodic: true },
  { kind: "transition", label: "Transition", melodic: false },
  { kind: "crash", label: "Crash / cymbal", melodic: false },
  { kind: "fx", label: "FX", melodic: false },
  { kind: "kick", label: "Kick", melodic: false },
  { kind: "snare", label: "Snare", melodic: false },
  { kind: "clap", label: "Clap", melodic: false },
  { kind: "hat_closed", label: "Closed hat", melodic: false },
  { kind: "hat_open", label: "Open hat", melodic: false },
  { kind: "perc", label: "Perc", melodic: false },
  { kind: "tom", label: "Tom", melodic: false },
  { kind: "ride", label: "Ride", melodic: false },
  { kind: "shaker", label: "Shaker", melodic: false },
  { kind: "rim", label: "Rim", melodic: false },
];

/** Starting point for each instrument in the sound maker. */
export const INSTRUMENT_PATCH: Record<SoundKind, Partial<Patch>> = {
  bass: { osc1Wave: "saw", sub: 0.5, cutoff: 500, resonance: 2, filterEnv: 2.5, filterDecay: 0.18, decay: 0.25, sustain: 0.5, release: 0.05, length: 0.8, drive: 0.15 },
  lead: { osc1Wave: "saw", osc2Level: 0.6, osc2Detune: 12, cutoff: 3500, resonance: 1.5, filterEnv: 1.5, filterDecay: 0.3, sustain: 0.8, release: 0.15, length: 1.5 },
  pad: { osc1Wave: "saw", unison: 5, spread: 20, cutoff: 1800, filterEnv: 1, filterAttack: 0.6, filterDecay: 1.5, filterSustain: 0.5, attack: 0.5, decay: 1, sustain: 0.8, release: 1.2, length: 4 },
  stab: { osc1Wave: "square", osc2Wave: "saw", osc2Level: 0.5, osc2Semi: 7, cutoff: 1500, resonance: 2, filterEnv: 3, filterDecay: 0.15, decay: 0.2, sustain: 0.2, release: 0.1, length: 0.6 },
  pluck: { osc1Wave: "triangle", osc2Wave: "saw", osc2Level: 0.3, cutoff: 900, resonance: 3, filterEnv: 4, filterDecay: 0.12, decay: 0.3, sustain: 0, release: 0.1, length: 0.7 },
  fx: { osc1Wave: "saw", noise: 0.5, cutoff: 600, resonance: 6, filterEnv: 5, filterAttack: 1.5, filterDecay: 0.5, attack: 1.5, decay: 0.5, sustain: 0.3, release: 0.4, length: 2.5 },
  kick: { osc1Wave: "sine", osc1Level: 1, tune: -7, pitchEnv: 36, pitchDecay: 0.045, cutoff: 6000, attack: 0, decay: 0.35, sustain: 0, release: 0.05, length: 0.6, drive: 0.25 },
  snare: { osc1Wave: "triangle", osc1Level: 0.6, tune: 19, pitchEnv: 7, pitchDecay: 0.03, noise: 0.7, filterType: "highpass", cutoff: 180, attack: 0, decay: 0.16, sustain: 0, release: 0.05, length: 0.35, drive: 0.2 },
  clap: { osc1Level: 0, noise: 1, filterType: "bandpass", cutoff: 1300, resonance: 1.4, attack: 0, decay: 0.2, sustain: 0, release: 0.05, length: 0.4 },
  hat_closed: { osc1Wave: "square", osc1Level: 0.3, fmRatio: 7.5, fmAmount: 12, tune: 48, noise: 0.8, filterType: "highpass", cutoff: 7000, attack: 0, decay: 0.05, sustain: 0, release: 0.02, length: 0.12 },
  hat_open: { osc1Wave: "square", osc1Level: 0.3, fmRatio: 7.5, fmAmount: 12, tune: 48, noise: 0.8, filterType: "highpass", cutoff: 6000, attack: 0, decay: 0.35, sustain: 0, release: 0.08, length: 0.6 },
  perc: { osc1Wave: "sine", osc1Level: 1, tune: 31, pitchEnv: 5, pitchDecay: 0.02, cutoff: 8000, attack: 0, decay: 0.15, sustain: 0, release: 0.05, length: 0.3 },
  tom: { osc1Wave: "sine", osc1Level: 1, tune: 7, pitchEnv: 12, pitchDecay: 0.08, noise: 0.05, cutoff: 5000, attack: 0, decay: 0.4, sustain: 0, release: 0.08, length: 0.7 },
  ride: { osc1Wave: "square", osc1Level: 0.4, fmRatio: 5.5, fmAmount: 9, tune: 48, noise: 0.4, filterType: "highpass", cutoff: 4000, attack: 0, decay: 1.2, sustain: 0, release: 0.3, length: 2 },
  shaker: { osc1Level: 0, noise: 1, filterType: "highpass", cutoff: 5000, attack: 0.01, decay: 0.08, sustain: 0, release: 0.03, length: 0.15 },
  rim: { osc1Wave: "triangle", osc1Level: 1, tune: 43, fmRatio: 2.5, fmAmount: 1.5, filterType: "bandpass", cutoff: 1700, resonance: 2, attack: 0, decay: 0.04, sustain: 0, release: 0.02, length: 0.1 },
  piano: { osc1Wave: "triangle", fmAmount: 1.2, cutoff: 5000, decay: 0.6, sustain: 0, length: 1.5 },
  electric_piano: { osc1Wave: "sine", fmAmount: 2, cutoff: 5000, decay: 0.8, sustain: 0.15, length: 1.6 },
  organ: { osc1Wave: "square", osc2Wave: "sine", osc2Level: 0.6, osc2Semi: 12, cutoff: 3000, sustain: 0.8, release: 0.08, length: 1.2 },
  chord: { osc1Wave: "saw", osc2Wave: "triangle", osc2Level: 0.25, chord: "minor7", cutoff: 1800, filterEnv: 1.5, filterDecay: 0.2, decay: 0.35, sustain: 0.15, release: 0.12, length: 1 },
  strings: { osc1Wave: "saw", unison: 5, spread: 14, cutoff: 2400, attack: 0.2, sustain: 0.8, release: 0.6, length: 2.5 },
  brass: { osc1Wave: "saw", osc2Level: 0.4, osc2Detune: 6, cutoff: 1200, filterEnv: 2, filterAttack: 0.04, attack: 0.03, decay: 0.2, sustain: 0.6, length: 1 },
  guitar: { osc1Wave: "triangle", osc2Wave: "sine", osc2Level: 0.2, osc2Semi: 12, cutoff: 3500, decay: 0.2, sustain: 0, length: 0.7 },
  mallet: { osc1Wave: "sine", fmRatio: 3.5, fmAmount: 2, cutoff: 8000, decay: 0.7, sustain: 0, length: 1.3 },
  vocal: { osc1Wave: "saw", osc2Wave: "triangle", osc2Level: 0.2, vowel: "ah", noise: 0.03, cutoff: 6500, attack: 0.015, decay: 0.2, sustain: 0.4, release: 0.1, length: 0.7 },
  atmosphere: { osc1Wave: "triangle", unison: 5, spread: 18, noise: 0.2, cutoff: 2000, attack: 0.8, sustain: 0.7, release: 1, length: 4 },
  crash: { osc1Wave: "square", osc1Level: 0.3, fmRatio: 5.5, fmAmount: 10, noise: 0.9, tune: 24, filterType: "highpass", cutoff: 3500, attack: 0.001, decay: 0.9, sustain: 0, release: 0.2, length: 1.8 },
  transition: { osc1Level: 0, noise: 1, filterType: "bandpass", cutoff: 400, resonance: 2, filterEnv: 4, filterAttack: 1.5, attack: 1.5, decay: 0.2, sustain: 0.7, release: 0.1, length: 2 },
}; // prettier-ignore

export const instrumentPatch = (kind: SoundKind): Patch => clampPatch(INSTRUMENT_PATCH[kind]);
