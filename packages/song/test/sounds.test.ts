import { describe, expect, it } from "vitest";
import {
  FACTORY,
  PARAMS,
  addSound,
  clampPatch,
  demoSong,
  editSound,
  findTrack,
  planStep,
  stateText,
  toolByName,
  type EditTool,
} from "../src/index.ts";

const design = toolByName("design_sound") as EditTool;

describe("design_sound", () => {
  it("adds a clamped sound to the song and puts it on a track", () => {
    const song = demoSong();
    const r = design.run(song, {
      name: "Rubber Acid",
      instrument: "bass",
      settings: { cutoff: 99999, resonance: 12, drive: 0.5, osc1Wave: "saw", bogus: 1, filterType: "notch" },
      track: "Bass",
    });
    const s = song.sounds![0]!;
    expect(s.id).toBe("user_rubber_acid");
    expect([s.kind, s.name, s.custom]).toEqual(["bass", "Rubber Acid", true]);
    expect(s.patch!.cutoff).toBe(20000);
    expect(s.patch!.resonance).toBe(12);
    expect(s.patch!.filterType).toBe("lowpass");
    expect("bogus" in s.patch!).toBe(false);
    expect(r.summary).toBe('New bass "Rubber Acid" (user_rubber_acid), now on Bass');
    const bass = findTrack(song, "Bass")!;
    expect(bass.type === "synth" && bass.sample).toBe("user_rubber_acid");
    // the event table plays the song's own sound like any other
    expect(planStep(song, 8 * 16 + 2).triggers.some((t) => t.sample === "user_rubber_acid")).toBe(true);
  });
  it("gives the same id when the same edits are replayed, and a fresh one for a second sound of that name", () => {
    const a = demoSong(),
      b = structuredClone(a);
    addSound(a, { name: "Wide Pad", instrument: "pad" });
    addSound(b, { name: "Wide Pad", instrument: "pad" });
    expect(a.sounds![0]!.id).toBe(b.sounds![0]!.id);
    expect(addSound(a, { name: "Wide Pad", instrument: "pad" }).soundId).toBe("user_wide_pad_2");
  });
  it("starts from a preset's patch, or reshapes a kit sample", () => {
    const song = demoSong();
    const preset = FACTORY.find((s) => s.kind === "lead")!;
    addSound(song, { name: "Lead copy", instrument: "lead", start_from: preset.id, settings: { cutoff: 500 } });
    expect(song.sounds![0]!.patch).toEqual({ ...preset.patch, cutoff: 500 });
    addSound(song, {
      name: "Backwards clap",
      instrument: "clap",
      start_from: "THK_Clap_01_Classic",
      settings: { reverse: true },
      track: "Tops",
      pad: 8,
    });
    const s = song.sounds![1]!;
    expect([s.patch!.engine, s.patch!.source, s.patch!.reverse]).toEqual(["sample", "THK_Clap_01_Classic", true]);
    const tops = findTrack(song, "Tops")!;
    expect(tops.type === "drums" && tops.pads[7]).toBe(s.id);
  });
  it("refuses unknown instruments and starting sounds", () => {
    expect(() => addSound(demoSong(), { name: "x", instrument: "kazoo" })).toThrow(/Unknown instrument "kazoo"/);
    expect(() => addSound(demoSong(), { name: "x", instrument: "bass", start_from: "zzz" })).toThrow(
      /Unknown sound "zzz"/,
    );
  });
});

describe("edit_sound", () => {
  it("changes the song's own sound", () => {
    const song = demoSong();
    addSound(song, { name: "Stab One", instrument: "stab" });
    const r = editSound(song, { sound: "stab one", settings: { cutoff: 300, length: 9 }, rename: "Dark Stab" });
    const s = song.sounds![0]!;
    expect([s.name, s.patch!.cutoff, s.patch!.length, s.dur]).toEqual(["Dark Stab", 300, 6, 6]);
    expect(r.summary).toBe('Changed "Dark Stab": cutoff, length');
  });
  it("never changes a built-in sound", () => {
    expect(() => editSound(demoSong(), { sound: "THK_Bass_02_Rolling_Saw_Pluck_C", settings: {} })).toThrow(
      /built-in sound/,
    );
    expect(() => editSound(demoSong(), { sound: "nope", settings: {} })).toThrow(/No sound "nope"/);
  });
});

describe("patches", () => {
  it("clamping keeps every number in range and every enum valid", () => {
    const wild = Object.fromEntries(PARAMS.map((p) => [p.key, 1e9]));
    const p = clampPatch(wild);
    for (const q of PARAMS) if ("max" in q) expect(p[q.key] as number, q.key).toBeLessThanOrEqual(q.max);
  });
  it("the assistant sees the song's own sounds", () => {
    const song = demoSong();
    addSound(song, { name: "Glass Pluck", instrument: "pluck" });
    expect(stateText(song)).toContain(
      'The song\'s own sounds (editable with edit_sound): user_glass_pluck (pluck, "Glass Pluck")',
    );
  });
});
