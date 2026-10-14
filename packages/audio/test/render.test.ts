import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { N, SPB, demoSong, emptySong, flatEvents, makeClip, stepDur, type Song } from "@thk/song";
import { Engine, RENDER_START, renderOffline, type TriggerOptions } from "../src/index.ts";
import { ROOT, db, kitBuffers, nodeOffline, peak, rms, seeded } from "./helpers.ts";

interface Recorded {
  time: number;
  track: string | null;
  sample: string;
  vel: number;
  rate: number;
  end: number | null;
  choke: string | null;
}
const fixture = JSON.parse(
  readFileSync(join(ROOT, "packages/audio/test/fixtures/demo-events.prototype.json"), "utf8"),
) as { events: Recorded[]; ducks: { time: number; track: string }[] };

const near = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 1e-9);
function sameEvents(a: Recorded[], b: Recorded[]) {
  expect(a).toHaveLength(b.length);
  a.forEach((e, i) => {
    const f = b[i]!;
    const ok =
      near(e.time, f.time) &&
      e.track === f.track &&
      e.sample === f.sample &&
      near(e.vel, f.vel) &&
      near(e.rate, f.rate) &&
      near(e.end, f.end) &&
      e.choke === f.choke;
    if (!ok) expect({ i, e }).toEqual({ i, e: f });
  });
}

describe("parity with the prototype", () => {
  const trig = Engine.prototype.trigger,
    duck = Engine.prototype.duck;
  afterEach(() => {
    Engine.prototype.trigger = trig;
    Engine.prototype.duck = duck;
  });

  it("the demo song's offline render schedules the same voices as the prototype", async () => {
    const events: Recorded[] = [],
      ducks: { time: number; track: string }[] = [];
    Engine.prototype.trigger = function (tr, sample, time, o: TriggerOptions = {}) {
      events.push({ time, track: tr?.name ?? null, sample, vel: o.vel ?? 1, rate: o.rate || 1, end: o.end ?? null, choke: o.choke ?? null }); // prettier-ignore
    };
    Engine.prototype.duck = function (tr, time) {
      ducks.push({ time, track: tr.name });
    };
    await renderOffline(demoSong(), { get: () => undefined }, { createContext: nodeOffline, sampleRate: 8000 });
    sameEvents(events, fixture.events);
    expect(ducks.length).toBe(fixture.ducks.length);
    ducks.forEach((d, i) =>
      expect(near(d.time, fixture.ducks[i]!.time) && d.track === fixture.ducks[i]!.track).toBe(true),
    );
  });

  it("flatEvents() lists the same voices, timed from the song start", () => {
    const { events } = flatEvents(demoSong());
    sameEvents(
      events.map((e) => ({ ...e, time: e.time + RENDER_START, end: e.end == null ? null : e.end + RENDER_START })),
      fixture.events.map((e) => ({ ...e })),
    );
  });
});

describe("offline render", () => {
  it("renders the demo song at a healthy level without clipping", async () => {
    const song = demoSong();
    const buf = await renderOffline(song, kitBuffers(), { createContext: nodeOffline, random: seeded(7) });
    const L = buf.getChannelData(0),
      R = buf.getChannelData(1),
      sr = buf.sampleRate;
    expect(buf.duration).toBeCloseTo(32 * 16 * stepDur(song) + 3, 1);
    const pk = Math.max(peak(L), peak(R));
    // node-web-audio-api's compressor lets the demo peak at ~1.04 in float; Chromium keeps it at or
    // under 1.0 (asserted in e2e/studio.spec.ts, as the prototype did). Export normalizes either way.
    expect(pk).toBeGreaterThan(0.1);
    expect(pk).toBeLessThan(1.1);
    expect(L.every(Number.isFinite)).toBe(true);
    const bar = (b: number) => Math.round((RENDER_START + b * SPB * stepDur(song)) * sr);
    const intro = db(rms(L, bar(0), bar(8))),
      main = db(rms(L, bar(16), bar(24))),
      tail = db(rms(L, bar(32) + sr, buf.length));
    // The master compressor holds the kick-dominated RMS steady across sections (about -8 dBFS).
    expect(main).toBeGreaterThan(-12);
    expect(main).toBeLessThan(-5);
    expect(Math.abs(main - intro)).toBeLessThan(1.5);
    // One second after the last bar only the reverb tail is left.
    expect(tail).toBeLessThan(main - 30);
  });

  it("lands every kick on the grid: the same latency for each hit, within one sample", async () => {
    const song: Song = emptySong();
    song.tracks[0]!.clips.push(
      makeClip(
        0,
        2,
        1,
        [0, 4, 8, 12].map((t) => N(t, 1, 0)),
      ),
    );
    const bufs = kitBuffers();
    const out = await renderOffline(song, bufs, { createContext: nodeOffline, random: seeded(1) });
    const d = out.getChannelData(0),
      k = bufs.get("THK_Kick_02_Classic_909_G")!.getChannelData(0),
      sr = out.sampleRate,
      sd = stepDur(song),
      W = Math.round(0.03 * sr);
    const lagOf = (at: number) => {
      let best = 0,
        bestLag = 0;
      for (let lag = 0; lag < Math.round(0.02 * sr); lag++) {
        let s = 0;
        for (let i = 0; i < W; i++) s += d[at + lag + i]! * k[i]!;
        if (s > best) [best, bestLag] = [s, lag];
      }
      return bestLag;
    };
    const lags = [0, 4, 8, 12, 16, 20, 24, 28].map((step) => lagOf(Math.round((RENDER_START + step * sd) * sr)));
    // The master compressor looks ahead a few ms, so all output is late by the same amount.
    expect(lags[0]! / sr).toBeLessThan(0.01);
    for (const l of lags) expect(Math.abs(l - lags[0]!)).toBeLessThanOrEqual(1);
  });

  it("ducks the bass on every kick", async () => {
    const make = (duck: boolean) => {
      const s = emptySong();
      const [drums, bass] = s.tracks;
      // A nearly silent kick: it still triggers the duck, but adds no energy of its own.
      drums!.clips.push(
        makeClip(
          0,
          2,
          1,
          [0, 4, 8, 12].map((t) => N(t, 1, 0)),
        ),
      );
      drums!.vol = 0.001;
      bass!.clips.push(makeClip(0, 2, 1, [N(0, 32, 41)]));
      if (bass!.type === "synth") {
        bass!.duck = duck;
        bass!.sample = "THK_Bass_10_Sub_Sustain_C";
      }
      return s;
    };
    const bufs = kitBuffers();
    const on = await renderOffline(make(true), bufs, { createContext: nodeOffline });
    const off = await renderOffline(make(false), bufs, { createContext: nodeOffline });
    const sr = on.sampleRate,
      sd = stepDur(make(true)),
      at = (s: number, ms: number) => Math.round((RENDER_START + s * sd + ms / 1000) * sr);
    const dip = rms(on.getChannelData(0), at(4, 5), at(4, 30)) / rms(off.getChannelData(0), at(4, 5), at(4, 30));
    const back = rms(on.getChannelData(0), at(4, 200), at(4, 240)) / rms(off.getChannelData(0), at(4, 200), at(4, 240));
    expect(dip).toBeLessThan(0.6);
    expect(back).toBeGreaterThan(0.9);
  });
});
