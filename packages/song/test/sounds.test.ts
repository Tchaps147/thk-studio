import { describe, expect, it } from "vitest";
import {
  FACTORY,
  KIT,
  CAT_DEFAULT,
  CHORD_FAMILIES,
  CAT,
  CATS,
  MELODIC,
  SOUND_GROUPS,
  PARAMS,
  addSound,
  clampPatch,
  demoSong,
  editSound,
  findTrack,
  planStep,
  stateText,
  toolByName,
  resolvePad,
  makeTrack,
  patchHash,
  type EditTool,
} from "../src/index.ts";
import originalFactory from "./fixtures/factory-before-essentials.json";

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
  it("places every category in exactly one group and supplies instrument defaults", () => {
    const categories = SOUND_GROUPS.flatMap((g) => g.categories);
    expect(new Set(categories).size).toBe(categories.length);
    expect([...categories].sort()).toEqual(CATS.map(([k]) => k).sort());
    expect(SOUND_GROUPS.map((g) => g.label)).toEqual(["Drums", "Bass", "Keys", "Synths", "Acoustic", "Vocals", "FX"]);
  });
  it("populates every instrument category with a usable default sound", () => {
    for (const [kind] of CATS) {
      expect(
        KIT.some((s) => s.kind === kind),
        kind,
      ).toBe(true);
      expect(KIT.find((s) => s.id === CAT_DEFAULT[kind])?.kind, kind).toBe(kind);
    }
    expect(KIT).toHaveLength(730);
    expect(FACTORY.filter((s) => s.kind === "chord")).toHaveLength(48);
    expect(FACTORY.filter((s) => s.kind === "vocal")).toHaveLength(12);
    expect(MELODIC.has("chord") && MELODIC.has("vocal")).toBe(true);
    expect(CAT.vocal.plural).toBe("Vocals & chops");
  });
  it("preserves the original preset ids and settings and includes 120 described house essentials", () => {
    const earlier = FACTORY.slice(0, originalFactory.length);
    expect(earlier.map((s) => ({ id: s.id, hash: patchHash(s.patch!) }))).toEqual(originalFactory);
    const added = FACTORY.slice(originalFactory.length, originalFactory.length + 120);
    expect(added).toHaveLength(120);
    expect(added.every((s) => !!s.description)).toBe(true);
    expect(new Set(added.map((s) => patchHash(s.patch!))).size).toBe(120);
  });
  it("adds twelve distinct acoustic guitar patches after the six existing guitars", () => {
    const guitars = FACTORY.filter((s) => s.kind === "guitar");
    expect(guitars).toHaveLength(18);
    expect(guitars[0]!.id).toBe("THK_Guitar_01_Muted_Funk_Pluck");
    const acoustic = guitars.slice(6);
    expect(acoustic[0]!.id).toBe("THK_Guitar_07_Acoustic_Nylon_Fingerpick");
    expect(acoustic.every((s) => s.name.startsWith("Acoustic ") && !!s.description)).toBe(true);
    expect(new Set(acoustic.map((s) => patchHash(s.patch!))).size).toBe(12);
    expect(acoustic.slice(-3).map((s) => s.patch!.chord)).toEqual(["major_open", "minor_open", "sus2"]);
  });
  it("covers all house chord families with distinct patches while keeping starter ids", () => {
    const chords = FACTORY.filter((s) => s.kind === "chord");
    expect(chords.slice(0, 8).map((s) => s.id)).toEqual([
      "THK_Chord_01_Deep_Minor_Seven",
      "THK_Chord_02_Bright_Major_House",
      "THK_Chord_03_Warm_Major_Seven",
      "THK_Chord_04_Dub_Minor_Stab",
      "THK_Chord_05_Garage_Seven",
      "THK_Chord_06_Disco_Dominant",
      "THK_Chord_07_Open_Suspended_Two",
      "THK_Chord_08_Rave_Suspended_Four",
    ]);
    for (const family of CHORD_FAMILIES)
      expect(chords.filter((s) => s.family === family.id).length, family.label).toBeGreaterThanOrEqual(5);
    const added = chords.slice(8);
    expect(new Set(added.map((s) => JSON.stringify(s.patch))).size).toBe(40);
    expect(added.every((s) => !!s.description && s.patch?.chord !== "none" && s.patch?.tune === 0)).toBe(true);
  });
  it("AI sound design retains chord voicings and vowel settings on editable sounds", () => {
    const song = demoSong();
    design.run(song, { name: "House Chord", instrument: "chord", settings: { chord: "major7" }, track: "Bass" });
    design.run(song, { name: "Oo Chop", instrument: "vocal", settings: { vowel: "oo" }, track: "Tops", pad: 8 });
    expect(song.sounds!.map((s) => [s.kind, s.patch?.chord, s.patch?.vowel])).toEqual([
      ["chord", "major7", undefined],
      ["vocal", undefined, "oo"],
    ]);
    expect(stateText(song)).toContain('user_oo_chop (vocal, "Oo Chop")');
  });
  it("assigns the new crash default to a drum pad without replacing a used pad", () => {
    const tr = makeTrack("drums", "Cymbals");
    if (tr.type !== "drums") throw new Error("Expected drums");
    const kick = tr.pads[0];
    const slot = resolvePad(tr, "crash", new Set([0]));
    expect(slot).not.toBe(0);
    expect(tr.pads[slot]).toBe("THK_Crash_01_Bright_House_Crash");
    expect(tr.pads[0]).toBe(kick);
  });
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
