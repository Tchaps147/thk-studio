import { describe, expect, it } from "vitest";
import { CHORD_VOICINGS, FACTORY, clampPatch, instrumentPatch, type Patch } from "@thk/song";
import { C2, peaksOf, renderPatch } from "../src/index.ts";
import { kitBuffers, nodeOffline, peak, rms } from "./helpers.ts";

const render = (p: Partial<Patch>, extra: Parameters<typeof renderPatch>[1] = {}) =>
  renderPatch(clampPatch(p), { createContext: nodeOffline, ...extra });

/** Strongest frequency between lo and hi Hz (Goertzel scan, 0.02 Hz steps, Hann window). */
function pitch(d: Float32Array, sr: number, from: number, secs: number, lo: number, hi: number): number {
  const n = Math.floor(secs * sr),
    a = Math.floor(from * sr),
    x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = d[a + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  let best = lo,
    bestMag = -1;
  for (let f = lo; f <= hi; f += 0.02) {
    const w = (2 * Math.PI * f) / sr;
    let re = 0,
      im = 0;
    for (let i = 0; i < n; i++) {
      re += x[i]! * Math.cos(w * i);
      im -= x[i]! * Math.sin(w * i);
    }
    const m = re * re + im * im;
    if (m > bestMag) [best, bestMag] = [f, m];
  }
  return best;
}
const cents = (f: number, ref: number) => 1200 * Math.log2(f / ref);
/** Share of energy in the first difference: a rough high-frequency measure. */
const brightness = (d: Float32Array, a = 0, b = d.length) => {
  let s = 0;
  for (let i = a + 1; i < b; i++) s += (d[i]! - d[i - 1]!) ** 2;
  return Math.sqrt(s / (b - a)) / rms(d, a, b);
};
const flat = { attack: 0, decay: 0.1, sustain: 1, release: 0.01, filterEnv: 0, cutoff: 20000 };

/** Hann-windowed amplitude at a frequency; enough resolution to distinguish chord thirds. */
function amplitude(d: Float32Array, sr: number, hz: number): number {
  const start = Math.round(sr * 0.15),
    n = Math.round(sr * 0.7);
  let re = 0,
    im = 0;
  for (let i = 0; i < n; i++) {
    const sample = d[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    re += sample * Math.cos((2 * Math.PI * hz * i) / sr);
    im -= sample * Math.sin((2 * Math.PI * hz * i) / sr);
  }
  return Math.hypot(re, im) / n;
}

describe("renderPatch", () => {
  it("FM attack decay reduces late brightness while retaining a sustained keyboard tone", async () => {
    const p = { ...flat, osc1Wave: "sine" as const, osc2Level: 0, fmRatio: 2, fmAmount: 4, length: 1 };
    const a = (await render({ ...p, fmDecay: 0.12 })).getChannelData(0);
    const constant = (await render(p)).getChannelData(0);
    const sr = 44100;
    expect(brightness(a, Math.round(sr * 0.01), Math.round(sr * 0.04))).toBeGreaterThan(
      brightness(a, Math.round(sr * 0.5), Math.round(sr * 0.8)) * 1.3,
    );
    expect(brightness(a, Math.round(sr * 0.5), Math.round(sr * 0.8))).toBeLessThan(
      brightness(constant, Math.round(sr * 0.5), Math.round(sr * 0.8)) * 0.5,
    );
    expect(rms(a, Math.round(sr * 0.5), Math.round(sr * 0.8))).toBeGreaterThan(0.03);
    expect(Array.from((await render({ ...p, fmDecay: 0 })).getChannelData(0))).toEqual(Array.from(constant));
  });
  it("renders each chord voicing with its root, third or suspension, fifth and seventh", async () => {
    for (const [chord, intervals] of Object.entries(CHORD_VOICINGS)) {
      if (chord === "none") continue;
      const b = await render({ ...flat, osc1Wave: "sine", osc2Level: 0, chord: chord as Patch["chord"], length: 1 });
      const d = b.getChannelData(0),
        root = amplitude(d, b.sampleRate, C2);
      for (const interval of intervals) {
        expect(amplitude(d, b.sampleRate, C2 * 2 ** (interval / 12)), `${chord}: ${interval}`).toBeGreaterThan(
          root * 0.65,
        );
      }
      const semitones: readonly number[] = intervals;
      const wrongThird = semitones.includes(3) ? 4 : semitones.includes(4) ? 3 : 1;
      expect(amplitude(d, b.sampleRate, C2 * 2 ** (wrongThird / 12)), chord).toBeLessThan(root * 0.08);
    }
  });

  it("vowel formants change the spectral balance while keeping output finite and bounded", async () => {
    const settings = { ...flat, osc1Wave: "saw" as const, osc2Level: 0, length: 1 };
    const ah = (await render({ ...settings, vowel: "ah" })).getChannelData(0);
    const ee = (await render({ ...settings, vowel: "ee" })).getChannelData(0);
    // Ah emphasizes the first formant near 730 Hz; Ee emphasizes the low formant near 270 Hz.
    const balance = (d: Float32Array) => amplitude(d, 44100, C2 * 11) / amplitude(d, 44100, C2 * 4);
    expect(balance(ah)).toBeGreaterThan(balance(ee) * 4);
    for (const d of [ah, ee]) {
      expect(d.every(Number.isFinite)).toBe(true);
      expect(peak(d)).toBeCloseTo(0.891, 2);
      expect(Math.abs(d.reduce((sum, x) => sum + x, 0) / d.length)).toBeLessThan(0.002);
    }
  });

  it("leaves legacy patches identical when chord and vowel controls are off", async () => {
    const p = instrumentPatch("bass");
    const legacy = (await render(p)).getChannelData(0);
    const explicit = (await render({ ...p, chord: "none", vowel: "off" })).getChannelData(0);
    expect(Array.from(explicit)).toEqual(Array.from(legacy));
  });

  it("roots melodic sounds on C2 and follows Tune", async () => {
    const sr = 44100;
    const c2 = await render({ ...flat, osc1Wave: "sine", length: 1.2 });
    expect(Math.abs(cents(pitch(c2.getChannelData(0), sr, 0.2, 0.8, 60, 72), C2))).toBeLessThan(5);
    const g2 = await render({ ...flat, osc1Wave: "sine", tune: 7, length: 1.2 });
    expect(Math.abs(cents(pitch(g2.getChannelData(0), sr, 0.2, 0.8, 90, 104), C2 * 2 ** (7 / 12)))).toBeLessThan(5);
  });

  it("peak-normalizes to -1 dBFS and renders exactly Length seconds", async () => {
    const b = await render({ length: 0.75 });
    expect(b.duration).toBeCloseTo(0.75, 2);
    expect(peak(b.getChannelData(0))).toBeCloseTo(0.891, 2);
  });

  it("shapes loudness with attack and release", async () => {
    const slow = (await render({ ...flat, osc1Wave: "sine", attack: 0.4, length: 1.5, release: 0.3 })).getChannelData(
      0,
    );
    const sr = 44100,
      ms = (t: number) => Math.round(t * sr);
    expect(rms(slow, 0, ms(0.05))).toBeLessThan(rms(slow, ms(0.6), ms(0.8)) * 0.2);
    expect(rms(slow, ms(1.49), ms(1.5))).toBeLessThan(rms(slow, ms(0.6), ms(0.8)) * 0.1);
  });

  it("a lowpass at 300 Hz is darker than one at 8 kHz", async () => {
    const dark = (await render({ ...flat, osc1Wave: "saw", cutoff: 300 })).getChannelData(0);
    const bright = (await render({ ...flat, osc1Wave: "saw", cutoff: 8000 })).getChannelData(0);
    expect(brightness(dark)).toBeLessThan(brightness(bright) * 0.5);
  });

  it("drive adds harmonics to a sine", async () => {
    const clean = (await render({ ...flat, osc1Wave: "sine", tune: 24 })).getChannelData(0);
    const driven = (await render({ ...flat, osc1Wave: "sine", tune: 24, drive: 0.8 })).getChannelData(0);
    expect(brightness(driven)).toBeGreaterThan(brightness(clean) * 1.3);
  });

  it("a pitch drop starts high and lands on the note (kicks)", async () => {
    const kick = await render(instrumentPatch("kick"));
    const d = kick.getChannelData(0),
      sr = kick.sampleRate,
      target = C2 * 2 ** (-7 / 12);
    const crossings = (a: number, b: number) => {
      let n = 0;
      for (let i = Math.floor(a * sr) + 1; i < Math.floor(b * sr); i++) if (d[i - 1]! < 0 !== d[i]! < 0) n++;
      return n / 2 / (b - a);
    };
    expect(crossings(0, 0.01)).toBeGreaterThan(target * 3);
    expect(Math.abs(cents(crossings(0.15, 0.35), target))).toBeLessThan(150);
  });

  it("the sample engine trims and reverses a kit sound", async () => {
    const src = kitBuffers().get("THK_Clap_01_Classic")!;
    const half = await render({ engine: "sample", ...flat, start: 0, end: 0.5, length: 2 }, { source: src });
    const rev = await render({ engine: "sample", ...flat, reverse: true, length: 2 }, { source: src });
    const n = src.length,
      h = half.getChannelData(0),
      r = rev.getChannelData(0);
    // Nothing after the trimmed end, allowing 5 ms for the drive stage's oversampling delay.
    expect(rms(h, Math.ceil(n * 0.5) + 220, n)).toBeLessThan(1e-3);
    expect(rms(h, 0, Math.floor(n * 0.4))).toBeGreaterThan(0.05);
    const loud = (d: Float32Array) => d.reduce((iMax, v, i, arr) => (Math.abs(v) > Math.abs(arr[iMax]!) ? i : iMax), 0);
    expect(loud(r)).toBeGreaterThan(n * 0.7); // the clap's attack now comes at the end
  });

  it("is deterministic, noise included", async () => {
    const p = instrumentPatch("hat_closed");
    const a = (await render(p)).getChannelData(0),
      b = (await render(p)).getChannelData(0);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("the new piano strikes decay while cymbal swells build toward their end", async () => {
    const sr = 22050;
    const buffer = async (name: string) => {
      const sound = FACTORY.find((s) => s.name === name)!;
      return (await renderPatch(sound.patch!, { createContext: nodeOffline, sampleRate: sr })).getChannelData(0);
    };
    const piano = await buffer("Classic Dance Piano");
    expect(rms(piano, Math.round(sr * 0.01), Math.round(sr * 0.08))).toBeGreaterThan(
      rms(piano, Math.round(sr * 0.8), Math.round(sr)) * 5,
    );
    const swell = await buffer("Cymbal Swell");
    expect(rms(swell, Math.round(sr * 1.15), Math.round(sr * 1.4))).toBeGreaterThan(
      rms(swell, 0, Math.round(sr * 0.1)) * 5,
    );
  });

  it("acoustic guitar plucks decay, steel is brighter than nylon and palm muting shortens the tail", async () => {
    const sr = 22050;
    const data = new Map<string, Float32Array>();
    for (const s of FACTORY.filter((s) => s.kind === "guitar" && s.name.startsWith("Acoustic "))) {
      const buffer = await renderPatch(s.patch!, { createContext: nodeOffline, sampleRate: sr });
      const d = buffer.getChannelData(0).slice();
      data.set(s.name, d);
      expect(rms(d, Math.round(sr * 0.01), Math.round(sr * 0.07)), s.name).toBeGreaterThan(
        rms(d, Math.round(d.length * 0.7), Math.round(d.length * 0.9)) * 5,
      );
    }
    const nylon = data.get("Acoustic Nylon Fingerpick")!,
      steel = data.get("Acoustic Steel String")!,
      mute = data.get("Acoustic Palm Mute")!;
    expect(brightness(steel, 220, 1544)).toBeGreaterThan(brightness(nylon, 220, 1544) * 1.2);
    expect(rms(mute, Math.round(sr * 0.2), Math.round(sr * 0.3))).toBeLessThan(
      rms(nylon, Math.round(sr * 0.2), Math.round(sr * 0.3)) * 0.1,
    );
  });

  it("every factory preset renders to its length, cleanly, at -1 dBFS", async () => {
    expect(FACTORY.length).toBeGreaterThanOrEqual(50);
    expect(new Set(FACTORY.map((s) => s.id)).size).toBe(FACTORY.length);
    for (const s of FACTORY) {
      const b = await renderPatch(s.patch!, { createContext: nodeOffline, sampleRate: 22050 });
      const d = b.getChannelData(0);
      expect(b.duration, s.id).toBeCloseTo(s.patch!.length, 3);
      expect(d.every(Number.isFinite), s.id).toBe(true);
      expect(peak(d), s.id).toBeCloseTo(0.891, 2);
      expect(rms(d), s.id).toBeGreaterThan(0.01);
      expect(peaksOf(b)).toHaveLength(60);
    }
  }, 60000);
});
