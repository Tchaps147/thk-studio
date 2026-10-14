import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BY_ID,
  CAT_DEFAULT,
  N,
  PatternError,
  SPB,
  carve,
  demoSong,
  emptySong,
  makeClip,
  makeTrack,
  parseKey,
  parseNote,
  parseSteps,
  resolvePad,
  resolveSound,
  sequentialIds,
  setIdGenerator,
  setSong,
  setTrack,
  tile,
  writeClip,
  writeDrums,
  writeNotes,
  type Clip,
  type Track,
} from "../src/index.ts";

let restore: () => void;
beforeEach(() => {
  restore = setIdGenerator(sequentialIds());
});
afterEach(() => restore());

/** Every note a track plays, as "absStep:pitch:velocity:length", sorted. */
function heard(tr: Track, from = 0, to = Infinity): string[] {
  const out: string[] = [];
  for (const c of tr.clips) {
    const L = c.loop * SPB,
      end = (c.start + c.len) * SPB;
    for (let base = c.start * SPB; base < end; base += L)
      for (const n of c.notes) {
        const abs = base + n.t;
        if (n.t >= L || abs >= end || abs < from * SPB || abs >= to * SPB) continue;
        out.push(`${abs}:${n.p}:${n.v}:${Math.min(n.d, end - abs)}`);
      }
  }
  return out.sort();
}
const drumTrack = (...clips: Clip[]) => {
  const t = makeTrack("drums", "D");
  t.clips.push(...clips);
  return t;
};

describe("tile", () => {
  const c = makeClip(0, 4, 1, [N(0, 1, 0), N(8, 4, 1)]);
  it("re-phases a pattern from an offset", () => {
    expect(tile(c, 4, 16)).toEqual([N(12, 1, 0), N(4, 4, 1)]);
  });
  it("clamps note length to the window", () => {
    expect(tile(c, 0, 10)).toEqual([N(0, 1, 0), N(8, 2, 1)]);
  });
  it("tiles a short pattern across a longer window", () => {
    expect(tile(c, 0, 32).map((n) => n.t)).toEqual([0, 16, 8, 24]);
  });
  it("skips notes past the pattern end", () => {
    const d = makeClip(0, 1, 1, [N(3, 1, 0), N(16, 1, 0)]);
    expect(tile(d, 0, 16)).toEqual([N(3, 1, 0)]);
  });
});

describe("carve", () => {
  it("splits a clip mid-pattern and the right piece sounds exactly as before", () => {
    const tr = drumTrack(makeClip(0, 8, 2, [N(0, 1, 0), N(20, 1, 1, 0.55), N(31, 1, 2)]));
    const before = heard(tr);
    carve(tr, 3, 5);
    expect(tr.clips.map((c) => [c.start, c.len, c.loop])).toEqual([
      [0, 3, 2],
      [5, 3, 2],
    ]);
    expect(heard(tr)).toEqual(before.filter((e) => +e.split(":")[0]! < 48 || +e.split(":")[0]! >= 80));
    expect(tr.clips[1]!.id).not.toBe(tr.clips[0]!.id);
  });
  it("removes clips fully inside the range and keeps clips outside it", () => {
    const tr = drumTrack(
      makeClip(0, 2, 1, [N(0, 1, 0)]),
      makeClip(2, 2, 1, [N(0, 1, 0)]),
      makeClip(6, 2, 1, [N(0, 1, 0)]),
    );
    carve(tr, 2, 4);
    expect(tr.clips.map((c) => c.start)).toEqual([0, 6]);
  });
  it("shortens a clip that starts before the range and ends inside it", () => {
    const tr = drumTrack(makeClip(0, 4, 1, [N(0, 1, 0)]));
    carve(tr, 2, 10);
    expect(tr.clips.map((c) => [c.start, c.len])).toEqual([[0, 2]]);
  });
  it("keeps a clip that ends exactly where the range starts", () => {
    const tr = drumTrack(makeClip(0, 2, 1, [N(0, 1, 0)]));
    carve(tr, 2, 4);
    expect(tr.clips).toHaveLength(1);
    expect(tr.clips[0]!.len).toBe(2);
  });
});

describe("writeClip", () => {
  it("an exact replace keeps the clip's id and name", () => {
    const old = makeClip(4, 4, 1, [N(0, 1, 0)], "Groove");
    const tr = drumTrack(old);
    const c = writeClip(tr, 4, 4, 2, () => [N(1, 1, 1)]);
    expect(c.id).toBe(old.id);
    expect(c.name).toBe("Groove");
    expect(tr.clips).toHaveLength(1);
    expect(c.loop).toBe(2);
  });
  it("passes the notes heard at the start, re-tiled to the new pattern length, for merging", () => {
    const tr = drumTrack(makeClip(0, 8, 1, [N(0, 1, 0), N(4, 1, 1)]));
    let base: unknown;
    writeClip(tr, 2, 2, 2, (b) => {
      base = b;
      return b;
    });
    expect(base).toEqual([N(0, 1, 0), N(16, 1, 0), N(4, 1, 1), N(20, 1, 1)]);
    expect(tr.clips.map((c) => [c.start, c.len])).toEqual([
      [0, 2],
      [2, 2],
      [4, 4],
    ]);
  });
  it("replaces several clips with one and leaves the bars around it unchanged", () => {
    const tr = drumTrack(makeClip(0, 4, 1, [N(0, 1, 0)]), makeClip(4, 4, 2, [N(3, 1, 1), N(17, 1, 2)]));
    const outside = heard(tr, 0, 2).concat(heard(tr, 6));
    writeClip(tr, 2, 4, 1, () => [N(8, 1, 5)]);
    expect(heard(tr, 0, 2).concat(heard(tr, 6))).toEqual(outside);
    expect(heard(tr, 2, 6)).toEqual(["40:5:1:1", "56:5:1:1", "72:5:1:1", "88:5:1:1"]);
  });
});

describe("parseSteps", () => {
  it("reads hits, soft hits and rests, and tiles short strings", () => {
    expect(parseSteps("x-o-", 8)).toEqual([
      [0, 1],
      [2, 0.55],
      [4, 1],
      [6, 0.55],
    ]);
  });
  it("ignores spaces and bar lines", () => {
    expect(parseSteps("x--- | ---- ---- ...X", 16)).toEqual([
      [0, 1],
      [15, 1],
    ]);
  });
  it("accepts underscores as rests", () => {
    expect(parseSteps("__x_", 4)).toEqual([[2, 1]]);
  });
  it("rejects other characters and empty strings", () => {
    expect(() => parseSteps("x-y-", 16)).toThrow(PatternError);
    expect(() => parseSteps("", 16)).toThrow(/Bad steps/);
    expect(() => parseSteps(undefined, 16)).toThrow(/Bad steps/);
  });
});

describe("parseNote and parseKey", () => {
  it("reads note names with C4 = 60", () => {
    expect(parseNote("C4")).toBe(60);
    expect(parseNote("F2")).toBe(41);
    expect(parseNote("C#3")).toBe(49);
    expect(parseNote("Bb1")).toBe(34);
    expect(parseNote("c-1")).toBe(0);
    expect(parseNote(53.4)).toBe(53);
  });
  it("rejects anything else", () => {
    expect(() => parseNote("H2")).toThrow(/Bad note/);
    expect(() => parseNote("F")).toThrow(/Bad note/);
  });
  it("reads keys", () => {
    expect(parseKey("F")).toBe(5);
    expect(parseKey("f#")).toBe(6);
    expect(parseKey("Cb")).toBe(11);
    expect(() => parseKey("minor")).toThrow(/Bad key/);
  });
});

describe("resolvePad", () => {
  it("finds a pad by category", () => {
    const tr = makeTrack("drums", "D");
    expect(resolvePad(tr, "kick", new Set())).toBe(0);
    expect(resolvePad(tr, "Hi hats", new Set())).toBe(2);
    expect(resolvePad(tr, "open_hat", new Set())).toBe(3);
  });
  it("re-points the same-category pad at a requested sound id", () => {
    const tr = makeTrack("drums", "D");
    expect(resolvePad(tr, "THK_HatC_03_Dark", new Set())).toBe(2);
    expect(tr.pads[2]).toBe("THK_HatC_03_Dark");
  });
  it("uses a pad that already holds the sound", () => {
    const tr = makeTrack("drums", "D");
    expect(resolvePad(tr, "THK_Shaker_01_Classic", new Set())).toBe(4);
  });
  it("follows the alias map for old ids", () => {
    const tr = makeTrack("drums", "D");
    expect(resolvePad(tr, "THK_Perc_06_Hat_Open", new Set())).toBe(3);
  });
  it("resolves a sound by name", () => {
    expect(resolveSound("Fat Ladder")).toBe("THK_Bass_25_Fat_Ladder_C");
    expect(resolveSound("closed hat dark")).toBe("THK_HatC_03_Dark");
    expect(resolveSound("zz")).toBeNull();
  });
  it("prefers an empty pad, then one no note plays, never one that is taken", () => {
    const tr = makeTrack("drums", "D");
    tr.pads[6] = null;
    expect(resolvePad(tr, "tom", new Set())).toBe(6);
    expect(tr.pads[6]).toBe(CAT_DEFAULT.tom);

    const busy = makeTrack("drums", "B");
    busy.clips.push(makeClip(0, 1, 1, [N(0, 1, 0), N(4, 1, 1)]));
    expect(resolvePad(busy, "closed hat", new Set([2]))).toBe(3);
    expect(BY_ID[busy.pads[3]!]!.kind).toBe("hat_closed");
  });
  it("refuses when every pad is in use, and rejects unknown sounds", () => {
    const tr = makeTrack("drums", "Full");
    tr.clips.push(
      makeClip(
        0,
        1,
        1,
        [0, 1, 2, 3, 4, 5, 6, 7].map((p) => N(p, 1, p)),
      ),
    );
    expect(() => resolvePad(tr, "tom", new Set())).toThrow(/All 8 pads on "Full" are in use/);
    expect(() => resolvePad(tr, "banana", new Set())).toThrow(/Unknown drum sound "banana"/);
  });
});

describe("writeDrums and writeNotes", () => {
  it("adds lanes without touching the others unless replace is set", () => {
    const song = emptySong();
    writeDrums(song, {
      track: "Drums",
      start: 0,
      len: 4,
      loop: 1,
      lanes: [{ sound: "kick", steps: "x---x---x---x---" }],
    });
    const r = writeDrums(song, {
      track: "Drums",
      start: 0,
      len: 4,
      loop: 1,
      lanes: [{ sound: "closed hat", steps: "--x-" }],
    });
    expect(r.summary).toBe("Drums bars 1–4 (1-bar pattern): closed hat Tight ×4");
    const tr = song.tracks[0]!;
    expect(tr.clips).toHaveLength(1);
    expect(tr.clips[0]!.notes.filter((n) => n.p === 0)).toHaveLength(4);
    writeDrums(song, {
      track: "Drums",
      start: 0,
      len: 4,
      loop: 1,
      lanes: [{ sound: "clap", steps: "----x---" }],
      replace: true,
    });
    expect(new Set(tr.clips[0]!.notes.map((n) => n.p))).toEqual(new Set([1]));
  });
  it("creates a missing track and refuses the wrong type", () => {
    const song = emptySong();
    writeDrums(song, { track: "Groove", start: 0, len: 16, loop: 1, lanes: [{ sound: "kick", steps: "x---" }] });
    expect(song.tracks.map((t) => t.name)).toEqual(["Drums", "Bass", "Groove"]);
    expect(() => writeNotes(song, { track: "Groove", notes: [] })).toThrow(
      /"Groove" is a drum track, not a synth track/,
    );
  });
  it("writes notes with clamping and sets the sound", () => {
    const song = emptySong();
    const r = writeNotes(song, {
      track: "Bass",
      start: 8,
      len: 8,
      loop: 1,
      sound: "THK_Bass_25_Fat_Ladder_C",
      notes: [
        { step: 2, note: "F2", len: 2 },
        { step: 40, note: "C7", len: 99, soft: true },
      ],
    });
    const tr = song.tracks[1]!;
    expect(tr.type === "synth" && tr.sample).toBe("THK_Bass_25_Fat_Ladder_C");
    expect(tr.clips[0]!.notes).toEqual([N(2, 2, 41), N(15, 16, 72, 0.55)]);
    expect(r.summary).toBe("Bass bars 9–16 (1-bar pattern): 2 notes, Fat Ladder");
  });
});

describe("setTrack and setSong", () => {
  it("changes mix values with clamping", () => {
    const song = emptySong();
    const r = setTrack(song, {
      track: "bass",
      volume: 3,
      filter_hz: 10,
      reverb: 0.5,
      pan: -2,
      duck: false,
      mono: false,
    });
    const t = song.tracks[1]!;
    expect([t.vol, t.cutoff, t.send, t.pan]).toEqual([1, 60, 0.5, -1]);
    expect(r.summary).toBe("Bass: volume 1.00, filter 60 Hz, reverb 50%, pan -1, no ducking, poly");
  });
  it("sets a pad sound and creates tracks on request", () => {
    const song = emptySong();
    setTrack(song, { track: "Drums", sound: "THK_Clap_08_Big_909", pad: 8 });
    expect(song.tracks[0]!.type === "drums" && song.tracks[0]!.pads[7]).toBe("THK_Clap_08_Big_909");
    expect(() => setTrack(song, { track: "Lead" })).toThrow(/No track "Lead"/);
    setTrack(song, { track: "Lead", create: "synth" });
    expect(song.tracks[2]!.type).toBe("synth");
  });
  it("changes tempo, key, swing and name with clamping", () => {
    const song = demoSong();
    expect(setSong(song, { bpm: 400, key: "G", swing: 10, name: "Next" })).toBe(
      "Song: 170 BPM, key G, swing 50%, renamed",
    );
    expect([song.bpm, song.key, song.swing, song.name]).toEqual([170, 7, 50, "Next"]);
  });
});
