// Renders a sound patch (packages/song/src/patch.ts) to a mono sample on an OfflineAudioContext.
// Melodic sounds are rooted on C2 like the kit's basses, so tracks play them chromatically.
// Rendering is deterministic: noise comes from a seeded generator.
import { CHORD_VOICINGS, type Patch } from "@thk/song";
import type { OfflineFactory } from "./render.ts";

export const C2 = 65.406;
const SR = 44100;
// Vowel resonances (Hz, bandwidth Hz, relative level), for synthetic chops rather than speech.
const FORMANTS = {
  ah: [
    [730, 100, 1],
    [1090, 110, 0.65],
    [2440, 170, 0.3],
  ],
  eh: [
    [530, 80, 1],
    [1840, 120, 0.55],
    [2480, 170, 0.25],
  ],
  ee: [
    [270, 65, 1],
    [2290, 120, 0.65],
    [3010, 180, 0.3],
  ],
  oh: [
    [570, 90, 1],
    [840, 100, 0.6],
    [2410, 170, 0.2],
  ],
  oo: [
    [300, 70, 1],
    [870, 100, 0.45],
    [2240, 160, 0.15],
  ],
} as const;
const WAVE: Record<Patch["osc1Wave"], OscillatorType> = {
  sine: "sine",
  triangle: "triangle",
  saw: "sawtooth",
  square: "square",
};

function seededNoise(ctx: BaseAudioContext, secs: number, seed = 1): AudioBuffer {
  const b = ctx.createBuffer(1, Math.max(1, Math.ceil(secs * ctx.sampleRate)), ctx.sampleRate),
    d = b.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < d.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return b;
}

/** tanh saturation curve; drive 0 is a straight line. */
function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const k = 1 + drive * 24,
    n = 2048,
    c = new Float32Array(n),
    norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

/** ADSR on a param: 0 -> peak over attack, -> sustain over decay, hold, -> 0 over release at the end. */
function adsr(
  param: AudioParam,
  from: number,
  peak: number,
  sus: number,
  a: number,
  d: number,
  r: number,
  len: number,
) {
  param.setValueAtTime(from, 0);
  param.linearRampToValueAtTime(peak, Math.max(a, 0.0005));
  param.setTargetAtTime(sus, Math.max(a, 0.0005), Math.max(d, 0.001) / 4);
  const relStart = Math.max(a + 0.001, len - r);
  param.setValueAtTime(sus + (peak - sus) * Math.exp((-(relStart - a) * 4) / Math.max(d, 0.001)), relStart);
  param.linearRampToValueAtTime(0, len);
}

export interface RenderPatchOptions {
  createContext?: OfflineFactory;
  sampleRate?: number;
  /** The decoded kit sound for the sample engine. */
  source?: AudioBuffer;
  seed?: number;
}

/** Renders a patch to a mono AudioBuffer, peak-normalized to -1 dBFS (like the kit). */
export async function renderPatch(p: Patch, o: RenderPatchOptions = {}): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? SR,
    len = p.length,
    create = o.createContext ?? ((ch, n, rate) => new OfflineAudioContext(ch, n, rate)),
    ctx = create(1, Math.ceil(len * sr), sr);
  const f0 = C2 * 2 ** (p.tune / 12);
  const mix = ctx.createGain();

  // pitch envelope: every oscillator's frequency is scaled by this multiplier over time
  const pitchAt = (freq: number, param: AudioParam) => {
    if (p.pitchEnv > 0) {
      param.setValueAtTime(freq * 2 ** (p.pitchEnv / 12), 0);
      param.exponentialRampToValueAtTime(freq, Math.max(0.002, p.pitchDecay));
    } else param.setValueAtTime(freq, 0);
  };

  if (p.engine === "sample") {
    if (o.source) {
      const src = o.source,
        ch = src.getChannelData(0),
        a = Math.floor(p.start * ch.length),
        b = Math.max(a + 1, Math.floor(p.end * ch.length)),
        cut = ctx.createBuffer(1, b - a, src.sampleRate),
        d = cut.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = ch[p.reverse ? b - 1 - i : a + i]!;
      const node = ctx.createBufferSource();
      node.buffer = cut;
      const rate = 2 ** (p.tune / 12);
      if (p.pitchEnv > 0) {
        node.playbackRate.setValueAtTime(rate * 2 ** (p.pitchEnv / 12), 0);
        node.playbackRate.exponentialRampToValueAtTime(rate, Math.max(0.002, p.pitchDecay));
      } else node.playbackRate.value = rate;
      node.connect(mix);
      node.start(0);
    }
  } else {
    const voices = Math.max(1, Math.round(p.unison));
    const intervals = CHORD_VOICINGS[p.chord ?? "none"];
    const oscs: [Patch["osc1Wave"], number, number][] = [];
    for (const interval of intervals) {
      const gain = 1 / Math.sqrt(intervals.length);
      oscs.push([p.osc1Wave, p.osc1Level * gain, interval]);
      if (p.osc2Level > 0) oscs.push([p.osc2Wave, p.osc2Level * gain, interval + p.osc2Semi + p.osc2Detune / 100]);
    }
    for (const [wave, level, semis] of oscs) {
      if (level <= 0) continue;
      for (let v = 0; v < voices; v++) {
        const spread = voices > 1 ? (v / (voices - 1) - 0.5) * 2 * p.spread : 0;
        const osc = ctx.createOscillator();
        osc.type = WAVE[wave];
        const freq = f0 * 2 ** ((semis + spread / 100) / 12);
        pitchAt(freq, osc.frequency);
        if (p.fmAmount > 0) {
          const mod = ctx.createOscillator(),
            depth = ctx.createGain();
          mod.type = "sine";
          pitchAt(freq * p.fmRatio, mod.frequency);
          depth.gain.value = p.fmAmount * freq;
          if (p.fmDecay && p.fmDecay > 0) {
            depth.gain.setValueAtTime(p.fmAmount * freq, 0);
            depth.gain.setTargetAtTime(0, 0, Math.max(0.001, p.fmDecay / 4));
          }
          mod.connect(depth);
          depth.connect(osc.frequency);
          mod.start(0);
        }
        const g = ctx.createGain();
        g.gain.value = level / Math.sqrt(voices);
        osc.connect(g);
        g.connect(mix);
        osc.start(0);
      }
    }
    if (p.sub > 0) {
      const sub = ctx.createOscillator(),
        g = ctx.createGain();
      sub.type = "sine";
      pitchAt(f0 / 2, sub.frequency);
      g.gain.value = p.sub;
      sub.connect(g);
      g.connect(mix);
      sub.start(0);
    }
    if (p.noise > 0) {
      const n = ctx.createBufferSource(),
        g = ctx.createGain();
      n.buffer = seededNoise(ctx, len, o.seed ?? 1);
      g.gain.value = p.noise * 0.6;
      n.connect(g);
      g.connect(mix);
      n.start(0);
    }
  }

  // filter with its own envelope (in octaves above the cutoff)
  const filter = ctx.createBiquadFilter();
  filter.type = p.filterType;
  filter.Q.value = p.resonance;
  const cut = (oct: number) => Math.min(sr / 2 - 100, Math.max(20, p.cutoff * 2 ** oct));
  if (p.filterEnv !== 0) {
    const peak = cut(p.filterEnv),
      sus = cut(p.filterEnv * p.filterSustain);
    filter.frequency.setValueAtTime(cut(0), 0);
    filter.frequency.exponentialRampToValueAtTime(peak, Math.max(0.001, p.filterAttack));
    filter.frequency.setTargetAtTime(sus, Math.max(0.001, p.filterAttack), Math.max(p.filterDecay, 0.001) / 4);
  } else filter.frequency.value = cut(0);

  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(p.drive);
  shaper.oversample = "4x";
  const amp = ctx.createGain();
  adsr(amp.gain, 0, 1, p.sustain, p.attack, p.decay, Math.min(p.release, len / 2), len);

  if (p.engine === "synth" && p.vowel && p.vowel !== "off") {
    for (const [hz, bandwidth, level] of FORMANTS[p.vowel]) {
      const formant = ctx.createBiquadFilter();
      formant.type = "bandpass";
      formant.frequency.value = Math.min(hz, sr / 2 - 100);
      formant.Q.value = hz / bandwidth;
      const gain = ctx.createGain();
      gain.gain.value = level;
      mix.connect(formant);
      formant.connect(gain);
      gain.connect(filter);
    }
  } else mix.connect(filter);
  filter.connect(shaper);
  shaper.connect(amp);
  amp.connect(ctx.destination);
  const out = await ctx.startRendering();

  const d = out.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > 1e-6) {
    const g = 0.891 / peak; // -1 dBFS
    for (let i = 0; i < d.length; i++) d[i]! *= g;
  }
  return out;
}

/** 60-bin peak envelope for the browser's waveform, like the kit's. */
export function peaksOf(buf: AudioBuffer, bins = 60): number[] {
  const d = buf.getChannelData(0),
    out: number[] = [],
    size = Math.max(1, Math.floor(d.length / bins));
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = b * size; i < Math.min(d.length, (b + 1) * size); i++) m = Math.max(m, Math.abs(d[i]!));
    out.push(Math.round(m * 1000) / 1000);
  }
  return out;
}
