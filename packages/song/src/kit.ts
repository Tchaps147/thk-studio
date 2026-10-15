import data from "./kit-data.json" with { type: "json" };
import recordings from "./recorded-data.json" with { type: "json" };
import recordedLibrary from "./recorded-library-data.json" with { type: "json" };
import { FACTORY } from "./presets.ts";
import type { Song, Sound, SoundKind } from "./types.ts";

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
  ["lead", "Leads", "Lead"],
  ["pad", "Pads", "Pad"],
  ["stab", "Stabs", "Stab"],
  ["pluck", "Plucks", "Pluck"],
  ["fx", "FX", "FX"],
  ["piano", "Pianos", "Piano"],
  ["electric_piano", "Electric pianos", "Electric piano"],
  ["organ", "Organs", "Organ"],
  ["chord", "Chords", "Chord"],
  ["strings", "Strings", "Strings"],
  ["brass", "Brass", "Brass"],
  ["guitar", "Guitars", "Guitar"],
  ["mallet", "Bells & mallets", "Bell / mallet"],
  ["vocal", "Vocals & chops", "Vocal"],
  ["atmosphere", "Atmospheres", "Atmosphere"],
  ["crash", "Crashes & cymbals", "Crash / cymbal"],
  ["transition", "Transitions", "Transition"],
];

/** Navigation groups are independent of sound ids and saved-song categories. */
export const SOUND_GROUPS: readonly { id: string; label: string; categories: readonly SoundKind[] }[] = [
  { id: "drums", label: "Drums", categories: ["kick", "clap", "snare", "hat_closed", "hat_open", "ride", "crash", "shaker", "rim", "perc", "tom"] },
  { id: "bass", label: "Bass", categories: ["bass"] },
  { id: "keys", label: "Keys", categories: ["piano", "electric_piano", "organ", "chord", "mallet"] },
  { id: "synths", label: "Synths", categories: ["lead", "pad", "stab", "pluck"] },
  { id: "acoustic", label: "Acoustic", categories: ["strings", "brass", "guitar"] },
  { id: "vocals", label: "Vocals", categories: ["vocal"] },
  { id: "fx", label: "FX", categories: ["fx", "atmosphere", "transition"] },
]; // prettier-ignore
/** Kinds a synth track plays chromatically (the rest are drum pads). */
export const MELODIC: ReadonlySet<SoundKind> = new Set([
  "bass", "lead", "pad", "stab", "pluck", "piano", "electric_piano", "organ", "chord",
  "strings", "brass", "guitar", "mallet", "vocal", "atmosphere",
]); // prettier-ignore
export const CAT = Object.fromEntries(CATS.map(([k, plural, one]) => [k, { plural, one }])) as Record<
  SoundKind,
  { plural: string; one: string }
>;

/** Every built-in sound: rendered kit, factory synths and recorded instruments. */
export const KIT: readonly Sound[] = [
  ...(data.sounds as Sound[]),
  ...FACTORY,
  ...(recordings as Sound[]),
  ...(recordedLibrary as Sound[]),
];
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

export const CAT_DEFAULT: Readonly<Partial<Record<SoundKind, string>>> = (() => {
  const d: Partial<Record<SoundKind, string>> = {};
  for (const s of KIT) d[s.kind] ??= s.id;
  d.kick = "THK_Kick_02_Classic_909_G";
  d.guitar = "THK_RecordedGuitar_01_Acoustic";
  return d;
})();

export const sound = (id: string | null | undefined): Sound | undefined => (id ? BY_ID[id] : undefined);
/** A built-in sound, or one of the song's own sounds. */
export const soundOf = (song: Song | undefined, id: string | null | undefined): Sound | undefined =>
  id ? (BY_ID[id] ?? song?.sounds?.find((s) => s.id === id)) : undefined;
/** Built-in sounds of a kind, then the song's own. */
export const soundsOfKind = (song: Song | undefined, kind: SoundKind) =>
  KIT.filter((s) => s.kind === kind).concat((song?.sounds ?? []).filter((s) => s.kind === kind));
export const sampleNum = (s: Sound) => s.id.split("_")[2] ?? "";
export const sampleLabel = (s: Sound) =>
  s.custom
    ? `${CAT[s.kind].one} · ${s.name} (mine)`
    : `${CAT[s.kind].one} ${sampleNum(s)} · ${s.name}` + (s.kind === "kick" && s.note ? ` (${s.note})` : "");
export const soundsOf = (kind: SoundKind) => KIT.filter((s) => s.kind === kind);
