import { describe, expect, it } from "vitest";
import { KIT, recordedSample, startingPatch, emptySong } from "../src/index.ts";

const acoustic = KIT.find((s) => s.id === "THK_RecordedGuitar_01_Acoustic")!;

describe("recorded instruments", () => {
  it("selects nearby recorded pitches without changing the note", () => {
    expect(recordedSample(acoustic, 48)).toEqual({ file: "GTR_Acoustic_48_v4_rr1", rate: 1 });
    expect(recordedSample(acoustic, 49)).toEqual({ file: "GTR_Acoustic_48_v4_rr1", rate: 2 ** (1 / 12) });
    expect(recordedSample(acoustic, 60)).toEqual({ file: "GTR_Acoustic_60_v4_rr1", rate: 1 });
    expect(recordedSample(acoustic, 36)?.rate).toBeCloseTo(2 ** (-1 / 12));
    expect(recordedSample(acoustic, 24)?.rate).toBeCloseTo(2 ** (-13 / 12));
  });
  it("uses dynamic layers and alternating takes deterministically", () => {
    expect(recordedSample(acoustic, 48, 0.6, 0)?.file).toBe("GTR_Acoustic_48_v2_rr1");
    expect(recordedSample(acoustic, 48, 0.6, 1)?.file).toBe("GTR_Acoustic_48_v2_rr2");
    expect(recordedSample(acoustic, 48, 0.6, 2)?.file).toBe("GTR_Acoustic_48_v2_rr1");
    expect(recordedSample(acoustic, 48, 1, 1)?.file).toBe("GTR_Acoustic_48_v4_rr2");
    expect(recordedSample(KIT[0]!, 48)).toBeUndefined();
  });
  it("keeps the original sample editor's C2 copy workflow", () => {
    const p = startingPatch(emptySong(), "guitar", acoustic.id);
    expect(p.engine).toBe("sample");
    expect(p.source).toBe(acoustic.id);
    expect(p.sustain).toBe(1);
    expect(p.length).toBeCloseTo(acoustic.dur);
  });
});
