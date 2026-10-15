// Factory synth presets: permanent sound ids, like the kit's. Each is an instrument's starting
// patch plus a few changes. Only ever append; never rename or reorder (ids are permanent).
import { clampPatch, INSTRUMENT_PATCH, type Patch } from "./patch.ts";
import type { Sound, SoundKind } from "./types.ts";

type Def = [kind: SoundKind, prefix: string, name: string, changes: Partial<Patch>];

const DEFS: Def[] = [
  // ---- basses (synth; the 30 rendered basses stay in the kit) ----
  ["bass", "SynBass", "Rubber Sub", { osc1Wave: "sine", sub: 0.3, cutoff: 900, filterEnv: 1, drive: 0.35, decay: 0.4, sustain: 0.7 }],
  ["bass", "SynBass", "Acid Line", { osc1Wave: "saw", sub: 0.2, cutoff: 350, resonance: 12, filterEnv: 4.5, filterDecay: 0.14, drive: 0.4, sustain: 0.4 }],
  ["bass", "SynBass", "Tech Growl", { osc1Wave: "saw", osc2Wave: "square", osc2Level: 0.6, osc2Detune: 9, fmRatio: 0.5, fmAmount: 2, cutoff: 700, resonance: 4, filterEnv: 2, drive: 0.6 }],
  ["bass", "SynBass", "Deep Reese", { osc1Wave: "saw", osc2Wave: "saw", osc2Level: 0.8, osc2Detune: 22, unison: 3, spread: 12, sub: 0.4, cutoff: 600, filterEnv: 0.5, sustain: 0.9, length: 1.6 }],
  ["bass", "SynBass", "Donk", { osc1Wave: "square", sub: 0.3, cutoff: 1400, resonance: 6, filterEnv: 2, filterDecay: 0.06, decay: 0.12, sustain: 0, length: 0.35, tune: 12 }],
  ["bass", "SynBass", "Minimal Thump", { osc1Wave: "sine", osc1Level: 1, pitchEnv: 7, pitchDecay: 0.03, cutoff: 1200, decay: 0.18, sustain: 0.1, length: 0.4, drive: 0.2 }],
  ["bass", "SynBass", "Square Bounce", { osc1Wave: "square", sub: 0.45, cutoff: 800, resonance: 3, filterEnv: 2.5, filterDecay: 0.1, decay: 0.15, sustain: 0.3, length: 0.5 }],
  ["bass", "SynBass", "Chicago Organ", { osc1Wave: "square", osc2Wave: "sine", osc2Level: 0.7, osc2Semi: 12, sub: 0.3, cutoff: 2500, decay: 0.2, sustain: 0.4, length: 0.5 }],
  ["bass", "SynBass", "FM Wobble", { osc1Wave: "sine", fmRatio: 1, fmAmount: 4, sub: 0.3, cutoff: 1200, filterEnv: 1.5, filterDecay: 0.4, sustain: 0.8, length: 1.2, drive: 0.3 }],
  ["bass", "SynBass", "Rolling Pluck", { osc1Wave: "saw", sub: 0.35, cutoff: 300, resonance: 3, filterEnv: 3.5, filterDecay: 0.09, decay: 0.15, sustain: 0.15, length: 0.4 }],
  // ---- leads ----
  ["lead", "Lead", "Detuned Saw", { unison: 3, spread: 14, osc2Level: 0.5, cutoff: 5000 }],
  ["lead", "Lead", "Square Hook", { osc1Wave: "square", osc2Wave: "square", osc2Level: 0.4, osc2Semi: 12, cutoff: 2800, resonance: 2, filterEnv: 2, filterDecay: 0.2 }],
  ["lead", "Lead", "Acid Squeal", { osc1Wave: "saw", osc2Level: 0, cutoff: 600, resonance: 14, filterEnv: 5, filterDecay: 0.25, drive: 0.5 }],
  ["lead", "Lead", "Soft Sine", { osc1Wave: "sine", osc2Wave: "triangle", osc2Level: 0.3, osc2Semi: 12, cutoff: 6000, filterEnv: 0, attack: 0.02, release: 0.3 }],
  ["lead", "Lead", "Hoover", { osc1Wave: "saw", unison: 7, spread: 35, osc2Level: 0.7, osc2Semi: -12, pitchEnv: 2, pitchDecay: 0.15, cutoff: 4000, drive: 0.4, length: 2 }],
  ["lead", "Lead", "Sync Buzz", { osc1Wave: "saw", fmRatio: 2, fmAmount: 2.5, cutoff: 3000, resonance: 3, filterEnv: 2.5, drive: 0.3 }],
  ["lead", "Lead", "Whistle", { osc1Wave: "sine", osc1Level: 0.9, osc2Level: 0, noise: 0.08, cutoff: 8000, attack: 0.04, release: 0.2, tune: 12 }],
  // ---- pads ----
  ["pad", "Pad", "Warm Strings", { unison: 5, spread: 18, cutoff: 1600 }],
  ["pad", "Pad", "Dark Drone", { osc1Wave: "saw", osc2Wave: "square", osc2Level: 0.5, osc2Semi: -12, cutoff: 500, filterEnv: 0.5, length: 5 }],
  ["pad", "Pad", "Glass", { osc1Wave: "sine", fmRatio: 3.5, fmAmount: 1.5, unison: 3, spread: 10, cutoff: 7000, filterEnv: 0, attack: 0.3 }],
  ["pad", "Pad", "Breath", { osc1Wave: "triangle", osc1Level: 0.5, noise: 0.4, filterType: "bandpass", cutoff: 1200, resonance: 3, attack: 0.8, release: 1.5 }],
  ["pad", "Pad", "Choir Ah", { osc1Wave: "saw", unison: 5, spread: 12, filterType: "bandpass", cutoff: 900, resonance: 2.5, attack: 0.4 }],
  ["pad", "Pad", "Swell", { unison: 7, spread: 25, cutoff: 400, filterEnv: 4, filterAttack: 2, filterDecay: 2, filterSustain: 0.8, attack: 1.5, length: 5 }],
  // ---- stabs and chords ----
  ["stab", "Stab", "Minor Chord", { osc1Wave: "saw", osc2Wave: "saw", osc2Level: 0.6, osc2Semi: 3, sub: 0, cutoff: 1800 }],
  ["stab", "Stab", "Organ Hit", { osc1Wave: "square", osc2Wave: "sine", osc2Level: 0.7, osc2Semi: 12, cutoff: 3000, filterEnv: 1, decay: 0.15, sustain: 0.3 }],
  ["stab", "Stab", "Dub Chord", { osc1Wave: "saw", osc2Wave: "saw", osc2Level: 0.7, osc2Semi: 7, cutoff: 900, resonance: 4, filterEnv: 3, filterDecay: 0.25, sustain: 0.1, length: 1.2 }],
  ["stab", "Stab", "Rave Stab", { unison: 5, spread: 22, osc2Level: 0.6, osc2Semi: 12, cutoff: 2500, filterEnv: 2, drive: 0.4 }],
  ["stab", "Stab", "Piano Hit", { osc1Wave: "triangle", fmRatio: 1, fmAmount: 1.2, cutoff: 5000, filterEnv: 1, decay: 0.6, sustain: 0, length: 1.2 }],
  ["stab", "Stab", "Brass Blip", { osc1Wave: "saw", osc2Level: 0.4, osc2Detune: 7, cutoff: 1200, filterEnv: 2.5, filterAttack: 0.03, filterDecay: 0.12, sustain: 0.3 }],
  // ---- plucks ----
  ["pluck", "Pluck", "Marimba", { osc1Wave: "sine", fmRatio: 4, fmAmount: 1.5, osc2Level: 0, cutoff: 6000, filterEnv: 0, decay: 0.35, length: 0.6 }],
  ["pluck", "Pluck", "Bell", { osc1Wave: "sine", fmRatio: 3.5, fmAmount: 3, osc2Level: 0, cutoff: 9000, filterEnv: 0, decay: 1.2, length: 2, tune: 12 }],
  ["pluck", "Pluck", "Kalimba", { osc1Wave: "sine", fmRatio: 5, fmAmount: 1, osc2Wave: "triangle", osc2Level: 0.3, osc2Semi: 12, decay: 0.5, length: 0.9 }],
  ["pluck", "Pluck", "Saw Pluck", { osc1Wave: "saw", osc2Level: 0.4, osc2Detune: 10, cutoff: 600, filterEnv: 4.5, filterDecay: 0.1 }],
  ["pluck", "Pluck", "Electric Piano", { osc1Wave: "sine", fmRatio: 1, fmAmount: 2.2, osc2Level: 0, cutoff: 5000, filterEnv: 0, decay: 0.8, sustain: 0.15, length: 1.5 }],
  ["pluck", "Pluck", "Glass Drop", { osc1Wave: "triangle", osc2Wave: "sine", osc2Level: 0.5, osc2Semi: 19, cutoff: 7000, decay: 0.25, length: 0.5, tune: 12 }],
  // ---- fx ----
  ["fx", "FX", "Noise Riser", { osc1Level: 0, noise: 1, filterType: "bandpass", cutoff: 300, resonance: 4, filterEnv: 5, filterAttack: 3, attack: 3, sustain: 1, release: 0.05, length: 3.2 }],
  ["fx", "FX", "Downlifter", { osc1Wave: "saw", noise: 0.6, pitchEnv: 24, pitchDecay: 1, cutoff: 4000, filterEnv: -3, filterDecay: 1.5, attack: 0, decay: 2, sustain: 0, length: 2.5 }],
  ["fx", "FX", "Impact", { osc1Wave: "sine", osc1Level: 1, tune: -12, pitchEnv: 24, pitchDecay: 0.2, noise: 0.5, cutoff: 3000, attack: 0, decay: 1.5, sustain: 0, length: 2.5, drive: 0.5 }],
  ["fx", "FX", "Laser Zap", { osc1Wave: "square", pitchEnv: 40, pitchDecay: 0.12, tune: 12, noise: 0, cutoff: 6000, attack: 0, decay: 0.25, sustain: 0, length: 0.4 }],
  ["fx", "FX", "Sweep Up", { osc1Wave: "saw", unison: 5, spread: 30, cutoff: 200, resonance: 6, filterEnv: 6, filterAttack: 2.5, attack: 1.5, sustain: 1, length: 3 }],
  // ---- drums ----
  ["kick", "SynKick", "Sub Thump", {}],
  ["kick", "SynKick", "Punchy Click", { pitchEnv: 44, pitchDecay: 0.025, noise: 0.15, decay: 0.25, length: 0.45, drive: 0.4 }],
  ["kick", "SynKick", "Long Boom", { pitchEnv: 30, pitchDecay: 0.06, decay: 0.8, length: 1.2, drive: 0.15, tune: -9 }],
  ["kick", "SynKick", "Distorted", { pitchEnv: 40, decay: 0.3, drive: 0.9, length: 0.5 }],
  ["snare", "SynSnare", "Tech Snare", {}],
  ["snare", "SynSnare", "Noise Snap", { osc1Level: 0.3, noise: 1, cutoff: 1200, decay: 0.1, length: 0.25 }],
  ["clap", "SynClap", "Big Clap", { decay: 0.3, length: 0.6, drive: 0.2 }],
  ["clap", "SynClap", "Tight Clap", { cutoff: 1800, decay: 0.1, length: 0.2 }],
  ["hat_closed", "SynHatC", "Metal Tick", {}],
  ["hat_closed", "SynHatC", "Noise Hat", { osc1Level: 0, noise: 1, cutoff: 8000, decay: 0.04 }],
  ["hat_open", "SynHatO", "Sizzle", {}],
  ["perc", "SynPerc", "Bongo Blip", {}],
  ["perc", "SynPerc", "Cowbell", { osc1Wave: "square", osc2Wave: "square", osc2Level: 0.8, osc2Semi: 9, tune: 36, filterType: "bandpass", cutoff: 800, resonance: 2, decay: 0.25, length: 0.4 }],
  ["perc", "SynPerc", "Woodblock", { osc1Wave: "sine", tune: 46, pitchEnv: 3, decay: 0.05, length: 0.12 }],
  ["tom", "SynTom", "Floor Tom", {}],
]; // prettier-ignore

const slugName = (n: string) => n.replace(/[^A-Za-z0-9]+/g, "_");

/** Factory presets as catalog sounds. */
export const FACTORY: readonly Sound[] = (() => {
  const count: Record<string, number> = {};
  return DEFS.map(([kind, prefix, name, changes]) => {
    const n = (count[prefix] = (count[prefix] ?? 0) + 1);
    const patch = clampPatch(changes, clampPatch(INSTRUMENT_PATCH[kind]));
    return {
      id: `THK_${prefix}_${String(n).padStart(2, "0")}_${slugName(name)}`,
      kind,
      name,
      note: "",
      hz: 0,
      dur: patch.length,
      peaks: [],
      patch,
    };
  });
})();
