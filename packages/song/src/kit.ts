import data from "./kit-data.json" with { type: "json" };
import type { Sound, SoundKind } from "./types.ts";

export const SPB = 16;
/** Every bass sample is rooted on C2 = MIDI 36. */
export const ROOT = 36;
export const LOW = 24;
export const HIGH = 72;
export const FMIN = 60;
export const FMAX = 20000;
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const BLACK = new Set([1, 3, 6, 8, 10]);

export const CATS: readonly [SoundKind, string, string][] = [
  ["kick", "Kicks", "Kick"],
  ["clap", "Claps", "Clap"],
  ["snare", "Snares", "Snare"],
  ["hat_closed", "Closed hats", "Closed hat"],
  ["hat_open", "Open hats", "Open hat"],
  ["ride", "Rides", "Ride"],
  ["shaker", "Shakers", "Shaker"],
  ["rim", "Rims", "Rim"],
  ["perc", "Perc", "Perc"],
  ["tom", "Toms", "Tom"],
  ["bass", "Bass", "Bass"],
];
export const CAT = Object.fromEntries(CATS.map(([k, plural, one]) => [k, { plural, one }])) as Record<
  SoundKind,
  { plural: string; one: string }
>;

export const KIT: readonly Sound[] = data.sounds as Sound[];
export const BY_ID: Readonly<Record<string, Sound>> = Object.fromEntries(KIT.map((s) => [s.id, s]));
/** Old sound ids -> current ids. Ids are permanent; renames go through this map. */
export const ALIAS: Readonly<Record<string, string>> = data.alias;

export const DEFAULT_PADS = [
  "THK_Kick_02_Classic_909_G",
  "THK_Clap_01_Classic",
  "THK_HatC_01_Tight",
  "THK_HatO_01_Medium",
  "THK_Shaker_01_Classic",
  "THK_Rim_01_Shot",
  "THK_Snare_01_Tech",
  "THK_Perc_01_Conga_Hi",
] as const;
export const DEFAULT_SYNTH_SAMPLE = "THK_Bass_02_Rolling_Saw_Pluck_C";

export const CAT_DEFAULT: Readonly<Record<SoundKind, string>> = (() => {
  const d: Partial<Record<SoundKind, string>> = {};
  for (const s of KIT) d[s.kind] ??= s.id;
  d.kick = "THK_Kick_02_Classic_909_G";
  return d as Record<SoundKind, string>;
})();

export const sound = (id: string | null | undefined): Sound | undefined => (id ? BY_ID[id] : undefined);
export const sampleNum = (s: Sound) => s.id.split("_")[2] ?? "";
export const sampleLabel = (s: Sound) =>
  `${CAT[s.kind].one} ${sampleNum(s)} · ${s.name}` + (s.kind === "kick" ? ` (${s.note})` : "");
export const soundsOf = (kind: SoundKind) => KIT.filter((s) => s.kind === kind);
