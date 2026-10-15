// Song data model (HANDOFF.md 4.2). Bars are 0-based in data and 1-based in the UI and
// everything the assistant sees. Steps are 16ths.

import type { Patch } from "./patch.ts";

export type SoundKind =
  | "kick" | "clap" | "snare" | "hat_closed" | "hat_open" | "ride" | "shaker" | "rim" | "perc" | "tom"
  | "bass" | "lead" | "pad" | "stab" | "pluck" | "fx"
  | "piano" | "electric_piano" | "organ" | "chord" | "strings" | "brass" | "guitar" | "mallet"
  | "vocal" | "atmosphere" | "crash" | "transition"; // prettier-ignore

export type ChordFamily = "piano" | "organ" | "deep" | "dub" | "rave" | "disco" | "tech" | "minimal";

export interface SampleZone {
  /** Original recorded MIDI pitch. */
  root: number;
  maxVelocity: number;
  /** Alternating recorded takes, as bundled WAV file stems. */
  files: string[];
}

export interface Sound {
  id: string;
  kind: SoundKind;
  name: string;
  /** Note name for kicks ("F", "As"), empty otherwise. */
  note: string;
  hz: number;
  dur: number;
  /** 60-bin peak envelope, 0..1 (empty for patches until rendered). */
  peaks: number[];
  /** Synth settings: the sound is rendered from these instead of loaded from a file. */
  patch?: Patch;
  /** Made by the user (sound maker or assistant); stored in the song and the user's library. */
  custom?: boolean;
  family?: ChordFamily;
  description?: string;
  /** Recorded instrument; the C2 reference file remains available for sample editing. */
  sampleMap?: SampleZone[];
  recording?: { pack: string; author: string; license: string; source: string };
  tags?: string[];
  previewNote?: number;
}

export interface Note {
  /** Start step within the pattern. */
  t: number;
  /** Length in steps. */
  d: number;
  /** Pad index 0-7 (drums) or MIDI pitch (synth). */
  p: number;
  /** Velocity 0-1. */
  v: number;
}

export interface Clip {
  id: string;
  name: string;
  /** First bar in the arrangement. */
  start: number;
  /** Bars covered in the arrangement. */
  len: number;
  /** Pattern length in bars; the pattern repeats across len. */
  loop: number;
  notes: Note[];
}

interface TrackBase {
  id: string;
  name: string;
  color: number;
  vol: number;
  pan: number;
  cutoff: number;
  send: number;
  mute: boolean;
  solo: boolean;
  clips: Clip[];
}

export interface DrumTrack extends TrackBase {
  type: "drums";
  /** 8 sound ids; null = empty pad. */
  pads: (string | null)[];
}

export interface SynthTrack extends TrackBase {
  type: "synth";
  sample: string;
  mono: boolean;
  duck: boolean;
}

export type Track = DrumTrack | SynthTrack;
export type TrackType = Track["type"];

export interface LoopRange {
  on: boolean;
  /** True once the user (or a Try) set the range explicitly. */
  userSet?: boolean;
  start: number;
  /** Exclusive. */
  end: number;
}

export interface Song {
  v: 1;
  name: string;
  bpm: number;
  swing: number;
  /** Pitch class 0-11. */
  key: number;
  loop: LoopRange;
  cloudId?: string;
  tracks: Track[];
  /** Sounds made for this song (sound maker, assistant). Tracks refer to them by id. */
  sounds?: Sound[];
}
