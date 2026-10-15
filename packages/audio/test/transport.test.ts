import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { N, SPB, emptySong, makeClip, stepDur, type Song } from "@thk/song";
import { Engine, SampleBank, Transport, fmtPos, soundsUsed } from "../src/index.ts";

/** A fake audio clock plus an engine that records scheduled steps. */
function rig(song: Song) {
  const clock = { currentTime: 0 };
  const steps: [number, number][] = [];
  const engine = {
    sync: vi.fn(),
    stopAll: vi.fn(),
    scheduleStep: (_s: Song, step: number, time: number) => steps.push([step, time]),
  } as unknown as Engine;
  const t = new Transport(clock as unknown as AudioContext, engine, () => song);
  const advance = (secs: number) => {
    for (let i = 0; i < Math.round(secs / 0.025); i++) {
      clock.currentTime += 0.025;
      vi.advanceTimersByTime(25);
    }
  };
  return { clock, steps, engine, t, advance };
}
function twoBars() {
  const s = emptySong();
  s.tracks[0]!.clips.push(makeClip(0, 2, 1, [N(0, 1, 0)]));
  return s;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Transport", () => {
  it("schedules only what starts inside the 120 ms lookahead, on the audio clock with swing", () => {
    const song = twoBars(),
      { clock, steps, t } = rig(song);
    expect(t.play()).toBe(true);
    const sd = stepDur(song); // 0.12 s at 125 BPM
    expect(steps.map((s) => s[0])).toEqual([0]);
    expect(steps[0]![1]).toBeCloseTo(0.06);
    clock.currentTime = 0.05;
    vi.advanceTimersByTime(25);
    expect(steps.map((s) => s[0])).toEqual([0]);
    clock.currentTime = 0.07;
    vi.advanceTimersByTime(25);
    expect(steps.map((s) => s[0])).toEqual([0, 1]);
    expect(steps[1]![1]).toBeCloseTo(0.06 + sd + ((54 - 50) / 50) * sd);
  });
  it("keeps up with the clock and stops after the last bar", () => {
    const song = twoBars(),
      { steps, t, advance, engine } = rig(song);
    t.play();
    advance(1);
    const sd = stepDur(song);
    const last = steps[steps.length - 1]!;
    expect(last[0]).toBe(Math.floor((1 + 0.12 - 0.06) / sd));
    advance(4);
    expect(steps).toHaveLength(2 * SPB);
    expect(t.playing).toBe(false);
    expect(t.pos).toBe(0);
    expect(engine.stopAll).toHaveBeenCalled();
  });
  it("wraps inside the loop", () => {
    const song = twoBars();
    song.loop = { on: true, start: 1, end: 2 };
    const { steps, t, advance } = rig(song);
    t.play();
    advance(3);
    expect(steps[0]![0]).toBe(16);
    expect(Math.max(...steps.map((s) => s[0]))).toBe(31);
    expect(steps.filter((s) => s[0] === 16).length).toBeGreaterThan(1);
    expect(t.playing).toBe(true);
  });
  it("reads the playhead from the audio clock", () => {
    const song = twoBars(),
      { clock, t, advance } = rig(song);
    t.play();
    advance(0.5);
    const expected = (clock.currentTime - 0.06) / stepDur(song);
    expect(Math.abs(t.frame() - expected)).toBeLessThan(1);
  });
  it("seeks while playing and refuses an empty song", () => {
    const song = twoBars(),
      { steps, t, engine } = rig(song);
    t.play();
    steps.length = 0;
    t.seek(20);
    vi.advanceTimersByTime(25);
    expect(engine.stopAll).toHaveBeenCalled();
    expect(t.pos).toBe(20);
    const empty = rig(emptySong());
    expect(empty.t.play()).toBe(false);
  });
  it("formats positions as bar.beat.16th", () => {
    expect(fmtPos(0)).toBe("1.1.1");
    expect(fmtPos(16 + 4 + 3.5)).toBe("2.2.4");
  });
});

describe("SampleBank", () => {
  it("fetches and decodes each sound once, sharing in-flight loads", async () => {
    const fetcher = vi.fn(async (url: string) => new TextEncoder().encode(url).buffer as ArrayBuffer);
    const decoder = { decodeAudioData: vi.fn(async () => ({ duration: 1 }) as AudioBuffer) };
    const render = vi.fn(async () => ({ duration: 1 }) as AudioBuffer);
    const bank = new SampleBank(decoder, "/kit/", fetcher, render);
    await Promise.all([bank.load("THK_Clap_01_Classic"), bank.load("THK_Clap_01_Classic")]);
    await bank.load("THK_Clap_01_Classic");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/kit/THK_Clap_01_Classic.wav");
    expect(bank.has("THK_Clap_01_Classic")).toBe(true);
    await bank.loadKind("clap");
    expect(bank.size).toBe(8 + 2); // 8 kit claps fetched, 2 factory claps rendered
  });
  it("skips unknown ids and remembers failures", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("404");
    });
    const bank = new SampleBank({ decodeAudioData: vi.fn() }, "/kit/", fetcher);
    expect(await bank.load("nope")).toBeUndefined();
    expect(await bank.load("THK_Rim_01_Shot")).toBeUndefined();
    expect(await bank.load("THK_Rim_01_Shot")).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("knows every sound a song can play", () => {
    const s = emptySong();
    expect(soundsUsed(s)).toHaveLength(9);
  });
});
