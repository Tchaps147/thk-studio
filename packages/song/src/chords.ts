import type { ChordFamily } from "./types.ts";

export const CHORD_FAMILIES: readonly { id: ChordFamily; label: string }[] = [
  { id: "piano", label: "Piano house" },
  { id: "organ", label: "Organ & garage" },
  { id: "deep", label: "Deep & soulful" },
  { id: "dub", label: "Dub" },
  { id: "rave", label: "Rave" },
  { id: "disco", label: "Disco" },
  { id: "tech", label: "Tech house" },
  { id: "minimal", label: "Minimal" },
];
export const chordFamilyLabel = (id: ChordFamily) => CHORD_FAMILIES.find((f) => f.id === id)!.label;
