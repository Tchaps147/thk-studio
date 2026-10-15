import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KIT, N, emptySong, makeClip, makeTrack } from "@thk/song";
import { Engine, renderOffline } from "../src/index.ts";
import { ROOT, kitBuffers, nodeOffline, peak, readWav, rms, seeded } from "./helpers.ts";

const recordings = KIT.filter((s) => s.id.startsWith("THK_RecordedGuitar_"));
const dir = join(ROOT, "assets/recorded-guitars");

describe("real recorded guitars", () => {
  it("bundles the attributed CC0 takes with stable checksums and bounded, decaying audio", () => {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      license: string;
      instruments: { files: { file: string; sha256: string }[] }[];
    };
    expect(manifest.license).toBe("CC0-1.0");
    expect(readFileSync(join(dir, "LICENSE.txt"), "utf8")).toContain("CC0 1.0 Universal");
    expect(recordings).toHaveLength(2);
    for (const instrument of manifest.instruments) {
      expect(instrument.files).toHaveLength(28);
      for (const f of instrument.files) {
        const bytes = readFileSync(join(dir, f.file + ".wav"));
        expect(createHash("sha256").update(bytes).digest("hex"), f.file).toBe(f.sha256);
        const { samples: d, rate } = readWav(bytes);
        expect(rate).toBe(44100);
        expect(d.every(Number.isFinite), f.file).toBe(true);
        expect(peak(d), f.file).toBeLessThanOrEqual(0.892);
        expect(rms(d, 0, rate / 2), f.file).toBeGreaterThan(0.005);
        expect(rms(d, 0, rate / 2), f.file).toBeGreaterThan(rms(d, 4 * rate, 5 * rate) * 2);
        expect(Math.abs(d[0]!)).toBeLessThan(0.0001);
        expect(Math.abs(d[d.length - 1]!)).toBeLessThan(0.0001);
      }
    }
    const bank = kitBuffers();
    const acoustic = bank.get("GTR_Acoustic_48_v4_rr1")!.getChannelData(0);
    const electric = bank.get("GTR_Electric_48_v4_rr1")!.getChannelData(0);
    expect(Array.from(acoustic.slice(100, 500))).not.toEqual(Array.from(electric.slice(100, 500)));
    expect(peak(acoustic)).toBeGreaterThan(peak(bank.get("GTR_Acoustic_48_v2_rr1")!.getChannelData(0)));
  });

  it("the shared live/export engine uses the recorded pitch and alternates takes", async () => {
    const bank = kitBuffers(),
      ctx = nodeOffline(2, 44100, 44100);
    const source = ctx.createBufferSource.bind(ctx);
    const nodes: AudioBufferSourceNode[] = [];
    vi.spyOn(ctx, "createBufferSource").mockImplementation(() => {
      const node = source();
      nodes.push(node);
      return node;
    });
    const engine = new Engine(ctx, ctx.destination, false, bank, seeded(1));
    const id = "THK_RecordedGuitar_01_Acoustic";
    engine.trigger(null, id, 0, { rate: 2, vel: 0.5 }); // C3 uses a C3 recording, without octave stretching.
    engine.trigger(null, id, 0.25, { rate: 2, vel: 0.5 });
    engine.trigger(null, id, 0.5, { rate: 2 ** (13 / 12), vel: 1 });
    expect(nodes[0]!.buffer).toBe(bank.get("GTR_Acoustic_48_v2_rr1"));
    expect(nodes[1]!.buffer).toBe(bank.get("GTR_Acoustic_48_v2_rr2"));
    expect(nodes[2]!.buffer).toBe(bank.get("GTR_Acoustic_48_v4_rr1"));
    expect(nodes[0]!.playbackRate.value).toBe(1);
    expect(nodes[2]!.playbackRate.value).toBeCloseTo(2 ** (1 / 12));
    const b = await ctx.startRendering();
    expect(rms(b.getChannelData(0))).toBeGreaterThan(0.005);
    expect(peak(b.getChannelData(0))).toBeLessThan(1);
  });

  it("exports each instrument reproducibly with natural dynamics and no clipping", async () => {
    for (const instrument of recordings) {
      const song = emptySong();
      const track = makeTrack("synth", "Guitar", {
        sample: instrument.id,
        vol: 0.7,
        mono: false,
        duck: false,
        send: 0,
      });
      track.clips = [makeClip(0, 1, 1, [N(0, 3, 48, 0.6), N(4, 3, 48, 1), N(8, 3, 55, 0.7), N(12, 3, 60, 1)])];
      song.tracks = [track];
      const render = () => renderOffline(song, kitBuffers(), { createContext: nodeOffline, random: seeded(7) });
      const a = await render(),
        b = await render();
      expect(Array.from(a.getChannelData(0))).toEqual(Array.from(b.getChannelData(0)));
      expect(a.getChannelData(0).every(Number.isFinite)).toBe(true);
      expect(peak(a.getChannelData(0))).toBeLessThan(0.99);
      expect(rms(a.getChannelData(0), 0, 44100)).toBeGreaterThan(0.005);
    }
  });
});
