import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALIAS,
  BASS_GROOVES,
  BY_ID,
  DEFAULT_PADS,
  DRUM_GROOVES,
  KIT,
  N,
  OFFER_RESULT,
  PatternError,
  RULES,
  TOOLS,
  applyGroove,
  applyVariation,
  demoSong,
  dryRunVariations,
  emptySong,
  findTrack,
  flatEvents,
  lanesOf,
  localVariations,
  makeClip,
  migrate,
  parseVariations,
  pname,
  songEnd,
  stateText,
  toolByName,
  tryLoopEnd,
  type EditTool,
  type Song,
} from "../src/index.ts";

const ROOT = join(import.meta.dirname, "../../..");

/** Seeded PRNG so shuffles are repeatable. */
const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("kit", () => {
  it("matches assets/kit_meta.json and the alias map", () => {
    const meta = JSON.parse(readFileSync(join(ROOT, "assets/kit_meta.json"), "utf8")) as { file: string }[];
    const ids = meta.map((m) => m.file.split("/").pop()!.replace(".wav", "")).sort();
    const files = KIT.filter((s) => !s.patch);
    expect(files.map((s) => s.id).sort()).toEqual(ids);
    expect(ALIAS).toEqual(JSON.parse(readFileSync(join(ROOT, "assets/kit_alias.json"), "utf8")));
    expect(files).toHaveLength(115);
    expect(files.every((s) => s.peaks.length === 60)).toBe(true);
  });
  it("every id the code refers to exists", () => {
    const song = demoSong();
    const used = [
      ...DEFAULT_PADS,
      ...song.tracks.flatMap((t) => (t.type === "drums" ? t.pads : [t.sample])),
      ...Object.values(ALIAS),
    ];
    for (const id of used) expect(BY_ID[id!], id!).toBeDefined();
  });
});

describe("migrate", () => {
  it("rewrites v2 percussion ids and adds a key", () => {
    const old = {
      v: 1, name: "Old", bpm: 124, swing: 54, loop: { on: false, start: 0, end: 4 },
      tracks: [{ id: "a1", name: "Drums", type: "drums", color: 0, vol: 0.8, pan: 0, cutoff: 20000, send: 0, mute: false, solo: false, clips: [],
        pads: ["THK_Kick_02_Classic_909_G", "THK_Perc_01_Clap_Classic", "THK_Perc_04_Hat_Closed_Tight", "THK_Perc_06_Hat_Open", "THK_Perc_08_Shaker", "THK_Perc_09_Rim_Shot", "THK_Perc_10_Snare_Tech", "THK_Perc_11_Conga_Hi"] }],
    }; // prettier-ignore
    const s = migrate(old) as unknown as Song;
    expect(s.key).toBe(5);
    const pads = s.tracks[0]!.type === "drums" ? s.tracks[0]!.pads : [];
    expect(pads).toEqual([...DEFAULT_PADS]);
  });
  it("leaves invalid data alone", () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({ tracks: "x" })).toEqual({ tracks: "x" });
  });
});

describe("demo song", () => {
  it("is Late Shift: 32 bars in F at 125 BPM with four tracks", () => {
    const s = demoSong();
    expect([s.name, songEnd(s), s.key, s.bpm]).toEqual(["Late Shift (demo)", 32, 5, 125]);
    expect(s.tracks.map((t) => t.name)).toEqual(["Kick", "Tops", "Bass", "Organ stab"]);
  });
  it("plays the expected number of voices", () => {
    const { events, ducks } = flatEvents(demoSong());
    // kick 28 bars x 4; bass 20 bars x 6; stabs 16 bars of a 4-bar 12-note pattern
    expect(events.filter((e) => e.track === "Kick")).toHaveLength(112);
    expect(events.filter((e) => e.track === "Bass")).toHaveLength(120);
    expect(events.filter((e) => e.track === "Organ stab")).toHaveLength(48);
    expect(ducks).toHaveLength(112 * 2);
  });
});

describe("grooves", () => {
  it("bass grooves follow the song key", () => {
    const s = demoSong();
    const bass = findTrack(s, "Bass")!;
    const acid = BASS_GROOVES.find((g) => g.name === "Acid walk")!;
    applyGroove(s, bass, bass.clips[0]!, acid);
    expect(pname(findTrack(s, "Bass")!.clips[0]!.notes[0]!.p)).toBe("F2");
    s.key = 7;
    applyGroove(s, bass, bass.clips[0]!, acid);
    expect(pname(bass.clips[0]!.notes[0]!.p)).toBe("G2");
  });
  it("a chord groove turns mono off", () => {
    const s = demoSong();
    const bass = findTrack(s, "Bass")!;
    applyGroove(
      s,
      bass,
      bass.clips[0]!,
      BASS_GROOVES.find((g) => g.poly)!,
    );
    expect(bass.type === "synth" && bass.mono).toBe(false);
  });
  it("drum grooves replace the clip and keep its bars", () => {
    const s = demoSong();
    const tops = findTrack(s, "Tops")!,
      c = tops.clips[1]!;
    applyGroove(s, tops, c, DRUM_GROOVES[1]!);
    const after = tops.clips.find((x) => x.start === 8)!;
    expect([after.start, after.len, after.loop, after.name]).toEqual([8, 16, 1, "Classic tech house"]);
    expect(lanesOf(after)).toHaveLength(4);
  });
});

describe("local variations", () => {
  it("keep the clip's own kick lane", () => {
    const s = emptySong();
    const d = s.tracks[0]!;
    d.clips.push(
      makeClip(
        0,
        8,
        1,
        [0, 4, 8, 12].map((t) => N(t, 1, 0)),
      ),
    );
    const vs = localVariations(s, d, d.clips[0]!, mulberry(1));
    expect(vs).toHaveLength(3);
    for (const v of vs) {
      expect((v.lanes as { sound: string; steps: string }[])[0]).toEqual({
        sound: "THK_Kick_02_Classic_909_G",
        steps: "x---x---x---x---",
      });
      expect(v.why).toMatch(/Keeps your kick\.$/);
    }
  });
  it("leave the kick out when another track plays one there", () => {
    const s = demoSong();
    const tops = findTrack(s, "Tops")!;
    for (const v of localVariations(s, tops, tops.clips[1]!, mulberry(2))) {
      expect((v.lanes as { sound: string }[]).some((l) => l.sound === "kick")).toBe(false);
      expect(v.why).toMatch(/Leaves the kick to your kick track\.$/);
      applyVariation(structuredClone(s), v);
    }
  });
  it("build bass options on the clip's most common note", () => {
    const s = demoSong();
    const bass = findTrack(s, "Bass")!;
    const vs = localVariations(s, bass, bass.clips[0]!, mulberry(3));
    expect(vs.every((v) => v.name.endsWith(" on F2") && v.kind === "notes")).toBe(true);
    expect(new Set(vs.map((v) => v.name)).size).toBe(3);
  });
  it("loop max(4, 2 x pattern) bars when tried", () => {
    expect(tryLoopEnd({ start: 8, len: 16, loop: 1 } as never)).toBe(12);
    expect(tryLoopEnd({ start: 8, len: 16, loop: 4 } as never)).toBe(16);
    expect(tryLoopEnd({ start: 8, len: 2, loop: 4 } as never)).toBe(10);
  });
});

describe("assistant tools", () => {
  const run = (song: Song, name: string, input: Record<string, unknown>) =>
    (toolByName(name) as EditTool).run(song, input);

  it("has the prototype's six tools plus the sound tools", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "write_drums",
      "write_notes",
      "set_track",
      "delete_clips",
      "set_song",
      "design_sound",
      "edit_sound",
      "offer_variations",
    ]);
    expect(RULES).toContain("Sound catalog\nKicks (kick): THK_Kick_01_Punchy_Tight_F");
  });
  it("runs the prototype's TEST1 sequence", () => {
    const s = demoSong();
    run(s, "write_drums", {
      track: "Groove",
      start_bar: 1,
      bars: 16,
      pattern_bars: 1,
      lanes: [{ sound: "kick", steps: "x---x---x---x---" }],
    });
    run(s, "write_drums", { track: "Groove", start_bar: 1, bars: 16, pattern_bars: 1, lanes: [{ sound: "closed hat", steps: "oo-xoo-xoo-xoo-x" }, { sound: "THK_HatO_04_Dark", steps: "--x---x---x---x-" }] }); // prettier-ignore
    expect(() =>
      run(s, "write_drums", {
        track: "Groove",
        start_bar: 1,
        bars: 4,
        pattern_bars: 1,
        lanes: [{ sound: "banana", steps: "x---" }],
      }),
    ).toThrow(PatternError);
    run(s, "write_notes", { track: "Bass", start_bar: 9, bars: 8, pattern_bars: 1, notes: [{ step: 2, note: "F2", len: 2 }, { step: 6, note: "G#2", len: 1 }], sound: "THK_Bass_25_Fat_Ladder_C" }); // prettier-ignore
    run(s, "set_song", { key: "G", bpm: 126 });
    expect(findTrack(s, "Groove")!.clips[0]!.notes).toHaveLength(20);
    const bass = findTrack(s, "Bass")!;
    expect(bass.type === "synth" && bass.sample).toBe("THK_Bass_25_Fat_Ladder_C");
    expect([s.key, s.bpm]).toEqual([7, 126]);
  });
  it("delete_clips splits at the edges", () => {
    const s = demoSong();
    const r = run(s, "delete_clips", { track: "Kick", from_bar: 5, to_bar: 8 });
    expect(r.summary).toBe("Cleared Kick bars 5–8");
    expect(findTrack(s, "Kick")!.clips.map((c) => [c.start, c.len])).toEqual([
      [0, 4],
      [8, 16],
      [28, 4],
    ]);
  });
  it("offer_variations parses and dry-runs without changing the song", () => {
    const s = demoSong();
    const before = JSON.stringify(s);
    const { title, specs } = parseVariations({
      title: "Drums for the bass",
      variations: [
        { name: "Sparse", kind: "drums", track: "Tops", start_bar: 9, bars: 16, pattern_bars: 1, lanes: [{ sound: "open hat", steps: "--x---x---x---x-" }] },
        { name: "Busy", kind: "drums", track: "Tops", start_bar: 9, bars: 16, pattern_bars: 2, lanes: [{ sound: "ride", steps: "o-xo" }, { sound: "clap", steps: "----x-------x---" }] },
        { name: "Bass alt", kind: "notes", track: "Bass", start_bar: 9, bars: 16, pattern_bars: 1, notes: [{ step: 3, note: "F1", len: 1 }] },
      ],
    }); // prettier-ignore
    expect(title).toBe("Drums for the bass");
    expect(specs.map((v) => [v.kind, v.start, v.len, v.loop, v.replace])).toEqual([
      ["drums", 8, 16, 1, true],
      ["drums", 8, 16, 2, true],
      ["notes", 8, 16, 1, true],
    ]);
    dryRunVariations(s, specs);
    expect(JSON.stringify(s)).toBe(before);
    expect(() => dryRunVariations(s, [{ ...specs[0]!, lanes: [{ sound: "banana", steps: "x" }] }])).toThrow(
      /^Variation 1: Unknown drum sound/,
    );
    expect(() => parseVariations({ variations: [] })).toThrow(/variations is empty/);
    expect(OFFER_RESULT(3)).toMatch(/^Shown 3 variations/);
  });
  it("describes the song state with lanes and notes", () => {
    const s = demoSong();
    const bass = findTrack(s, "Bass")!;
    const text = stateText(s, { tid: bass.id, cid: bass.clips[0]!.id });
    expect(text).toContain('Song "Late Shift (demo)": 125 BPM, key F, swing 54%, 32 bars long.');
    expect(text).toContain("Selected: Bass, clip bars 9-24.");
    expect(text).toContain("     pad 1 kick: x---x---x---x---");
    expect(text).toContain('   clip bars 9-24, 2-bar pattern "Rolling F":');
    expect(text).toContain("     2:F2/1 3:F2/1 6:F2/2 10:F2/1 11:F3/1 14:G#2/2");
  });
});
