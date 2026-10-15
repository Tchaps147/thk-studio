import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KIT, N, emptySong, makeClip, makeTrack, recordedSample } from "@thk/song";
import { renderOffline } from "../src/index.ts";
import { ROOT, kitBuffers, nodeOffline, peak, readWav, rms, seeded } from "./helpers.ts";

const dir = join(ROOT, "assets/recorded-library");
const library = KIT.filter((s) => s.id.startsWith("THK_Library_"));

describe("the recorded library", () => {
  it("bundles 370 distinct entries and their licensed, finite, bounded audio", () => {
    expect(library).toHaveLength(370);
    expect(library.filter((s) => s.sampleMap)).toHaveLength(38);
    expect(library.filter((s) => s.kind === "vocal")).toHaveLength(12);
    expect(new Set(library.map((s) => s.id)).size).toBe(370);
    expect(new Set(library.map((s) => s.name)).size).toBe(370);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      files: { asset: string; sha256: string; sourceSha256?: string }[];
      sources: Record<string, { license: string }>;
    };
    for (const [source, meta] of Object.entries(manifest.sources)) {
      expect(["CC0-1.0", "Public domain"]).toContain(meta.license);
      const permission = readFileSync(join(dir, "licenses", source + ".txt"), "utf8");
      expect(permission).toMatch(/CC0|Public Domain/);
    }
    for (const f of manifest.files) {
      const bytes = readFileSync(join(dir, f.asset + ".wav"));
      expect(createHash("sha256").update(bytes).digest("hex"), f.asset).toBe(f.sha256);
      if (f.sourceSha256) expect(f.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      const { samples: d, rate } = readWav(bytes);
      expect(rate).toBe(44100);
      expect(d.every(Number.isFinite), f.asset).toBe(true);
      expect(peak(d), f.asset).toBeLessThanOrEqual(0.892);
      expect(rms(d), f.asset).toBeGreaterThan(0.00001);
      expect(Math.abs(d[0]!), f.asset).toBeLessThan(0.0001);
      expect(Math.abs(d[d.length - 1]!), f.asset).toBeLessThan(0.0001);
    }
  });

  it("maps real instrument previews to recorded pitches and exports every instrument", async () => {
    for (const sound of library.filter((s) => s.sampleMap)) {
      const selected = recordedSample(sound, sound.previewNote!)!;
      expect(selected.rate, sound.name).toBe(1);
      const song = emptySong();
      const track = makeTrack("synth", sound.name, { sample: sound.id, mono: false, duck: false, vol: 0.7, send: 0 });
      track.clips = [makeClip(0, 1, 1, [N(0, 4, sound.previewNote!, 0.7), N(8, 4, sound.previewNote!, 1)])];
      song.tracks = [track];
      const buffer = await renderOffline(song, kitBuffers(), {
        createContext: nodeOffline,
        sampleRate: 22050,
        random: seeded(7),
      });
      const d = buffer.getChannelData(0);
      expect(d.every(Number.isFinite), sound.name).toBe(true);
      expect(peak(d), sound.name).toBeLessThan(1);
      expect(rms(d, 0, 22050), sound.name).toBeGreaterThan(0.0001);
    }
  });
  it("keeps long vocal phrases ringing beyond the final clip in WAV export", async () => {
    const phrase = library.find((s) => s.name === "Microlag Fantastic")!;
    const song = emptySong();
    const drums = makeTrack("drums", "Vocal phrases");
    drums.pads[0] = phrase.id;
    drums.clips = [makeClip(0, 1, 1, [N(15, 1, 0)])];
    song.tracks = [drums];
    const buffer = await renderOffline(song, kitBuffers(), {
      createContext: nodeOffline,
      sampleRate: 22050,
      random: seeded(7),
    });
    expect(buffer.duration).toBeGreaterThan(phrase.dur + 4);
    expect(buffer.getChannelData(0).every(Number.isFinite)).toBe(true);
  });
  it("keeps the calibrated piano, keyboard, harp and bass recordings at their mapped pitch", () => {
    const bank = kitBuffers();
    for (const name of [
      "Kawai Grand Piano",
      "Steinway Close Piano",
      "TX81Z FM Piano",
      "Concert Harp",
      "Darkblack Finger Bass",
      "Babyblue Pick Bass",
    ]) {
      const sound = library.find((s) => s.name === name)!;
      const zone = sound.sampleMap!.find((z) => z.root === sound.previewNote && z.maxVelocity === 1)!;
      const buffer = bank.get(zone.files[0]!)!,
        d = buffer.getChannelData(0),
        sr = buffer.sampleRate;
      const frequency = 440 * 2 ** ((zone.root - 69) / 12),
        period = sr / frequency;
      let best = -1;
      for (let lag = Math.floor(period * 0.98); lag <= Math.ceil(period * 1.02); lag++) {
        let cross = 0,
          a = 0,
          b = 0;
        for (let i = Math.round(sr * 0.3); i < Math.round(sr * 0.65); i++) {
          cross += d[i]! * d[i + lag]!;
          a += d[i]! ** 2;
          b += d[i + lag]! ** 2;
        }
        best = Math.max(best, cross / Math.sqrt(a * b));
      }
      expect(best, name).toBeGreaterThan(0.65);
    }
  });
});
