// What plays when (HANDOFF.md 4.3-4.4), without any audio. The audio engine turns these into
// voices; tests compare them with the prototype's event list.
import { BY_ID, ROOT, SPB } from "./kit.ts";
import { audible, songEnd } from "./model.ts";
import type { Note, Song, Track } from "./types.ts";

export interface TableEvent {
  track: Track;
  note: Note;
  /** Sounding length in steps, clamped to the clip end. */
  d: number;
}
export type EventTable = Map<number, TableEvent[]>;

const tables = new WeakMap<Song, EventTable>();

/** step -> events for the whole song. Cached per song object (songs are immutable in the app). */
export function eventTable(song: Song): EventTable {
  const cached = tables.get(song);
  if (cached) return cached;
  const T: EventTable = new Map();
  for (const tr of song.tracks)
    for (const c of tr.clips) {
      const L = c.loop * SPB,
        start = c.start * SPB,
        end = (c.start + c.len) * SPB;
      for (let base = start; base < end; base += L)
        for (const nt of c.notes) {
          if (nt.t >= L) continue;
          const abs = base + nt.t;
          if (abs >= end) continue;
          let list = T.get(abs);
          if (!list) T.set(abs, (list = []));
          list.push({ track: tr, note: nt, d: Math.min(nt.d, end - abs) });
        }
    }
  tables.set(song, T);
  return T;
}

export interface Trigger {
  track: Track;
  sample: string;
  vel: number;
  /** playbackRate: 2^((pitch - 36) / 12) for synth notes, 1 for drums. */
  rate: number;
  /** Gate length in steps for synth notes; null for one-shot drums. */
  steps: number | null;
  /** Voice that this one cuts: "hat", "pad<n>", "mono" or null. */
  choke: string | null;
}
export interface StepPlan {
  triggers: Trigger[];
  /** Synth tracks to duck (one entry per audible kick hit). */
  ducks: Track[];
}

const HATS = new Set(["hat_closed", "hat_open"]);

/** Voices to start and tracks to duck at one step. */
export function planStep(song: Song, step: number): StepPlan {
  const evs = eventTable(song).get(step),
    plan: StepPlan = { triggers: [], ducks: [] };
  if (!evs) return plan;
  for (const { track: tr, note: nt, d } of evs) {
    const v = nt.v ?? 1;
    if (tr.type === "drums") {
      const id = tr.pads[nt.p],
        smp = id ? BY_ID[id] : undefined;
      if (!id || !smp) continue;
      plan.triggers.push({
        track: tr,
        sample: id,
        vel: v,
        rate: 1,
        steps: null,
        choke: HATS.has(smp.kind) ? "hat" : "pad" + nt.p,
      });
      if (smp.kind === "kick" && audible(song, tr))
        for (const o of song.tracks) if (o.type === "synth" && o.duck) plan.ducks.push(o);
    } else if (BY_ID[tr.sample]) {
      plan.triggers.push({
        track: tr,
        sample: tr.sample,
        vel: v,
        rate: 2 ** ((nt.p - ROOT) / 12),
        steps: d,
        choke: tr.mono ? "mono" : null,
      });
    }
  }
  return plan;
}

export const stepDur = (song: Song) => 60 / song.bpm / 4;
/** Swing delays odd 16ths by (swing - 50) / 50 of a step. */
export const swingOffset = (song: Song, step: number) => (step % 2 ? ((song.swing - 50) / 50) * stepDur(song) : 0);

export interface FlatEvent {
  step: number;
  /** Seconds from the song start, swing included. */
  time: number;
  track: string;
  sample: string;
  vel: number;
  rate: number;
  /** Gate end in seconds from the song start, or null. */
  end: number | null;
  choke: string | null;
}
/** Every voice the song starts, in schedule order. Used for parity checks and offline render. */
export function flatEvents(song: Song): { events: FlatEvent[]; ducks: { time: number; track: string }[] } {
  const sd = stepDur(song),
    total = songEnd(song) * SPB,
    events: FlatEvent[] = [],
    ducks: { time: number; track: string }[] = [];
  for (let s = 0; s < total; s++) {
    const time = s * sd + swingOffset(song, s),
      plan = planStep(song, s);
    for (const t of plan.triggers)
      events.push({
        step: s,
        time,
        track: t.track.name,
        sample: t.sample,
        vel: t.vel,
        rate: t.rate,
        end: t.steps == null ? null : time + t.steps * sd,
        choke: t.choke,
      });
    for (const d of plan.ducks) ducks.push({ time, track: d.name });
  }
  return { events, ducks };
}
