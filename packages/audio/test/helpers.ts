import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfflineAudioContext } from "node-web-audio-api";
import { KIT, ROOT as ROOT_NOTE, recordedSample } from "@thk/song";
import type { BufferLookup, OfflineFactory } from "../src/index.ts";

export const ROOT = join(import.meta.dirname, "../../..");

// node-web-audio-api implements the Web Audio API for Node; its types are its own, so cast at the boundary.
export const nodeOffline: OfflineFactory = (ch, len, sr) =>
  new OfflineAudioContext(ch, len, sr) as unknown as ReturnType<OfflineFactory>;

/** 24- or 16-bit PCM WAV -> mono samples. Faster than decodeAudioData in node-web-audio-api (~30 s for the kit). */
export function readWav(bytes: Uint8Array): { rate: number; samples: Float32Array<ArrayBuffer> } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  let rate = 0,
    bits = 0,
    channels = 1,
    data: [number, number] | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const size = dv.getUint32(o + 4, true);
    if (tag(o) === "fmt ")
      [channels, rate, bits] = [dv.getUint16(o + 10, true), dv.getUint32(o + 12, true), dv.getUint16(o + 22, true)];
    if (tag(o) === "data") data = [o + 8, size];
    o += 8 + size + (size & 1);
  }
  if (!data) throw new Error("no data chunk");
  const step = (bits / 8) * channels,
    n = Math.floor(data[1] / step),
    out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = data[0] + i * step;
    if (bits === 24) {
      let v = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
      if (v & 0x800000) v -= 0x1000000;
      out[i] = v / 8388608;
    } else out[i] = dv.getInt16(o, true) / 32768;
  }
  return { rate, samples: out };
}

let cache: BufferLookup | null = null;
/** Lazy access to original kit WAVs and bundled recordings, for real-engine tests. */
export function kitBuffers(): BufferLookup {
  if (!cache) {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const meta = JSON.parse(readFileSync(join(ROOT, "assets/kit_meta.json"), "utf8")) as { file: string }[];
    const paths = new Map(
      meta.map((m) => [m.file.split("/").pop()!.replace(".wav", ""), join(ROOT, "assets/TechHouse_Synth_Kit", m.file)]),
    );
    const guitars = JSON.parse(readFileSync(join(ROOT, "assets/recorded-guitars/manifest.json"), "utf8")) as {
      instruments: { id: string; files: { file: string }[] }[];
    };
    for (const s of guitars.instruments)
      for (const id of [s.id, ...s.files.map((f) => f.file)])
        paths.set(id, join(ROOT, "assets/recorded-guitars", id + ".wav"));
    const library = JSON.parse(readFileSync(join(ROOT, "assets/recorded-library/manifest.json"), "utf8")) as {
      files: { asset: string }[];
    };
    for (const f of library.files) paths.set(f.asset, join(ROOT, "assets/recorded-library", f.asset + ".wav"));
    const map = new Map<string, AudioBuffer>();
    const get = (id: string) => {
      const have = map.get(id);
      if (have) return have;
      const path = paths.get(id);
      if (!path) return undefined;
      const { rate, samples } = readWav(readFileSync(path));
      const b = ctx.createBuffer(1, samples.length, rate);
      b.copyToChannel(samples, 0);
      const out = b as unknown as AudioBuffer;
      map.set(id, out);
      return out;
    };
    cache = {
      get,
      resolve: (id, rate, velocity, take) => {
        const sound = KIT.find((s) => s.id === id);
        const selected = sound && recordedSample(sound, ROOT_NOTE + 12 * Math.log2(rate), velocity, take);
        const buffer = selected && get(selected.file);
        return selected && buffer ? { buffer, rate: selected.rate } : undefined;
      },
    };
  }
  return cache;
}

export const peak = (d: Float32Array, a = 0, b = d.length) => {
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(d[i]!));
  return m;
};
export const rms = (d: Float32Array, a = 0, b = d.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += d[i]! * d[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
};
export const db = (x: number) => 20 * Math.log10(x);

/** Seeded PRNG (mulberry32) for repeatable reverb impulses. */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
