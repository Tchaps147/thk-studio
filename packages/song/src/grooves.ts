import { BY_ID } from "./kit.ts";
import { pname, type Random } from "./model.ts";
import { lanesOf, writeDrums, writeNotes, type DrumLane, type WriteResult } from "./pattern.ts";
import type { Clip, Song, Track } from "./types.ts";

export interface DrumGroove {
  name: string;
  bars: number;
  desc: string;
  lanes: Record<string, string>;
}
export interface BassGroove {
  name: string;
  bars: number;
  desc: string;
  poly?: boolean;
  /** [step, len, semitones above the root] */
  notes: [number, number, number][];
}

const K4 = "x---x---x---x---",
  CL = "----x-------x---",
  OH = "--x---x---x---x-";
export const DRUM_GROOVES: readonly DrumGroove[] = [
  { name: "Four to the floor", bars: 1, desc: "Kick on every beat, nothing else.", lanes: { kick: K4 } },
  { name: "Classic tech house", bars: 1, desc: "Clap on 2 and 4, offbeat open hat, 16th closed hats.", lanes: { kick: K4, clap: CL, hat_open: OH, hat_closed: "oo-xoo-xoo-xoo-x" } },
  { name: "Offbeat hats", bars: 1, desc: "Open hats in every gap between kicks.", lanes: { kick: K4, hat_open: OH } },
  { name: "Rolling 16ths", bars: 1, desc: "Driving 16th closed hats with an accented shaker.", lanes: { kick: K4, clap: CL, hat_closed: "xoxoxoxoxoxoxoxo", shaker: "ooxoooxoooxoooxo" } },
  { name: "Shuffle", bars: 1, desc: "Hats on the 'and-a'. Push swing to about 60%.", lanes: { kick: K4, clap: CL, hat_closed: "--xo--xo--xo--xo", shaker: "o-o-o-o-o-o-o-o-" } },
  { name: "Minimal tick", bars: 1, desc: "Sparse rim syncopation and ticking hats.", lanes: { kick: K4, rim: "-------x--x----x", hat_closed: "--x---x---x---x-" } },
  { name: "Jackin' house", bars: 1, desc: "Chicago feel: clap, offbeat hats and a rim answer.", lanes: { kick: K4, clap: CL, hat_closed: "--x---x---x---x-", rim: "---x------x--x--" } },
  { name: "Tribal perc", bars: 2, desc: "Conga call and answer with a rim on the 'and'.", lanes: { kick: K4 + K4, perc: "--x-x--x--x-x--x--x-x--x-x--x-x-", rim: "------x-------x-------x-------x-", shaker: "ooxoooxoooxoooxoooxoooxoooxoooxo" } },
  { name: "Ride groove", bars: 1, desc: "Ride on the offbeats with ghost 16ths.", lanes: { kick: K4, clap: CL, ride: "o-xoo-xoo-xoo-xo" } },
  { name: "Breakdown (no kick)", bars: 1, desc: "Clap, shaker and soft open hats, no kick.", lanes: { clap: CL, shaker: "ooxoooxoooxoooxo", hat_open: "--o---o---o---o-" } },
  { name: "Snare roll build", bars: 4, desc: "Snare doubling up every bar into the drop.", lanes: { snare: "x-------x-------x---x---x---x---x-x-x-x-x-x-x-x-xxxxxxxxxxxxxxxx" } },
]; // prettier-ignore

export const BASS_GROOVES: readonly BassGroove[] = [
  { name: "Offbeat root", bars: 1, desc: "One note in every gap between kicks.", notes: [[2,2,0],[6,2,0],[10,2,0],[14,2,0]] },
  { name: "Rolling 16ths", bars: 1, desc: "Two 16ths after each kick, the classic roll.", notes: [[2,1,0],[3,1,0],[6,1,0],[7,1,0],[10,1,0],[11,1,0],[14,1,0],[15,1,0]] },
  { name: "Bouncy octaves", bars: 1, desc: "Root then an octave jump in each gap.", notes: [[2,1,0],[3,1,12],[6,1,0],[7,1,12],[10,1,0],[11,1,12],[14,1,0],[15,1,7]] },
  { name: "Syncopated", bars: 1, desc: "Pushed notes that dodge the kick.", notes: [[3,2,0],[6,1,0],[9,2,0],[11,1,7],[14,2,0]] },
  { name: "Call and answer", bars: 2, desc: "A root bar, then a bar that walks down from the fifth.", notes: [[2,1,0],[3,1,0],[6,2,0],[10,1,0],[11,1,0],[14,2,3],[18,1,0],[19,1,0],[22,2,0],[26,1,7],[27,1,5],[30,2,3]] },
  { name: "Acid walk", bars: 1, desc: "Busy 16th line with octaves and the minor third.", notes: [[0,1,0],[1,1,0],[2,1,12],[3,1,0],[5,1,3],[6,1,0],[7,1,7],[9,1,0],[10,1,12],[11,1,0],[13,1,5],[14,1,3],[15,1,0]] },
  { name: "Donk bounce", bars: 1, desc: "Octave-up offbeats with root pickups.", notes: [[2,1,12],[3,1,0],[6,1,12],[7,1,0],[10,1,12],[11,1,0],[14,1,12],[15,1,7]] },
  { name: "Minimal pulse", bars: 1, desc: "Three notes a bar and lots of space.", notes: [[2,1,0],[7,1,0],[10,1,0]] },
  { name: "Long subs", bars: 2, desc: "Held notes for subby sounds.", notes: [[2,6,0],[10,4,0],[18,6,0],[26,4,-2]] },
  { name: "Minor chord stabs", bars: 2, poly: true, desc: "Offbeat minor chords an octave up. Best with an organ or stab sound.", notes: [[6,2,12],[6,2,15],[6,2,19],[14,1,12],[14,1,15],[14,1,19],[22,2,12],[22,2,15],[22,2,19],[30,2,10],[30,2,14],[30,2,17]] },
]; // prettier-ignore

/** Bass grooves are built on C2 + the song key. */
export const keyRoot = (song: Song) => 36 + (typeof song.key === "number" ? song.key : 5);

/** Replaces a clip with a groove preset (drums) or a groove in the song key (synth). */
export function applyGroove(song: Song, tr: Track, c: Clip, g: DrumGroove | BassGroove): WriteResult {
  if (tr.type === "drums") {
    const dg = g as DrumGroove;
    return writeDrums(song, {
      track: tr.id,
      start: c.start,
      len: c.len,
      loop: dg.bars,
      lanes: Object.entries(dg.lanes).map(([sound, steps]) => ({ sound, steps })),
      replace: true,
      name: dg.name,
    });
  }
  const bg = g as BassGroove;
  if (bg.poly) tr.mono = false;
  return writeNotes(song, {
    track: tr.id,
    start: c.start,
    len: c.len,
    loop: bg.bars,
    notes: bg.notes.map(([t, d, sm]) => ({ step: t, len: d, note: keyRoot(song) + sm })),
    name: bg.name,
  });
}

// ---------- variations (HANDOFF.md 4.6) ----------
export interface VariationSpec {
  name: string;
  why: string;
  kind: "drums" | "notes";
  track: unknown;
  start: number;
  len: number;
  loop: number;
  lanes?: unknown;
  notes?: unknown;
  sound?: unknown;
  replace?: boolean;
}

export const applyVariation = (song: Song, sp: VariationSpec): WriteResult =>
  sp.kind === "drums"
    ? writeDrums(song, { ...range(sp), track: sp.track, lanes: sp.lanes, replace: sp.replace ?? false, name: sp.name })
    : writeNotes(song, { ...range(sp), track: sp.track, notes: sp.notes, sound: sp.sound, name: sp.name });
const range = (sp: VariationSpec) => ({ start: sp.start, len: sp.len, loop: sp.loop });

const shuffled = <T>(a: readonly T[], random: Random) =>
  a
    .map((x) => [random(), x] as const)
    .sort((p, q) => p[0] - q[0])
    .map((x) => x[1]);

/** True when another drum track plays a kick somewhere in this clip's bars. */
export function kickElsewhere(song: Song, tr: Track, c: Clip): boolean {
  return song.tracks.some(
    (t) =>
      t.id !== tr.id &&
      t.type === "drums" &&
      t.clips.some(
        (k) =>
          k.start < c.start + c.len &&
          c.start < k.start + k.len &&
          k.notes.some((n) => BY_ID[t.pads[n.p] ?? ""]?.kind === "kick"),
      ),
  );
}

/**
 * Three alternatives for a clip from the groove library, no AI. Drums keep the clip's own kick
 * lane, or leave the kick out when another track already plays one there.
 */
export function localVariations(song: Song, tr: Track, c: Clip, random: Random = Math.random): VariationSpec[] {
  if (tr.type === "drums") {
    const kickLane = lanesOf(c).find((l) => BY_ID[tr.pads[l.pad] ?? ""]?.kind === "kick"),
      other = !kickLane && kickElsewhere(song, tr, c);
    return shuffled(
      DRUM_GROOVES.filter((g) => g.lanes.kick && g.bars <= 2 && Object.keys(g.lanes).length > 1),
      random,
    )
      .slice(0, 3)
      .map((g) => {
        const lanes: DrumLane[] = Object.entries(g.lanes)
          .filter(([k]) => k !== "kick" || (!kickLane && !other))
          .map(([sound, steps]) => ({ sound, steps }));
        if (kickLane) lanes.unshift({ sound: tr.pads[kickLane.pad], steps: kickLane.steps });
        return {
          name: g.name,
          why: g.desc + (kickLane ? " Keeps your kick." : other ? " Leaves the kick to your kick track." : ""),
          kind: "drums" as const,
          track: tr.id,
          start: c.start,
          len: c.len,
          loop: Math.max(g.bars, c.loop),
          lanes,
          replace: true,
        };
      });
  }
  const counts: Record<number, number> = {};
  c.notes.forEach((n) => {
    counts[n.p] = (counts[n.p] ?? 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0],
    root = top ? +top[0] : keyRoot(song);
  return shuffled(
    BASS_GROOVES.filter((g) => !g.poly),
    random,
  )
    .slice(0, 3)
    .map((g) => ({
      name: `${g.name} on ${pname(root)}`,
      why: g.desc,
      kind: "notes" as const,
      track: tr.id,
      start: c.start,
      len: c.len,
      loop: g.bars,
      notes: g.notes.map(([t, d, sm]) => ({ step: t, len: d, note: root + sm })),
    }));
}

/** Bars a Try loops: from the clip start, max(4, 2 x pattern length), within the clip. */
export const tryLoopEnd = (sp: VariationSpec) => sp.start + Math.min(sp.len, Math.max(4, sp.loop * 2));
