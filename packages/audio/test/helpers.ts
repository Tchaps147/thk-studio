import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfflineAudioContext } from "node-web-audio-api";
import { KIT } from "@thk/song";
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

let cache: Map<string, AudioBuffer> | null = null;
/** Every kit sound from the original 24-bit WAVs in assets/. */
export function kitBuffers(): BufferLookup {
  if (!cache) {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const meta = JSON.parse(readFileSync(join(ROOT, "assets/kit_meta.json"), "utf8")) as { file: string }[];
    const file = new Map(meta.map((m) => [m.file.split("/").pop()!.replace(".wav", ""), m.file]));
    const map = new Map<string, AudioBuffer>();
    for (const s of KIT) {
      const { rate, samples } = readWav(readFileSync(join(ROOT, "assets/TechHouse_Synth_Kit", file.get(s.id)!)));
      const b = ctx.createBuffer(1, samples.length, rate);
      b.copyToChannel(samples, 0);
      map.set(s.id, b as unknown as AudioBuffer);
    }
    cache = map;
  }
  const c = cache;
  return { get: (id) => c.get(id) };
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
