// Offline render for export (HANDOFF.md 4.8): the same Engine on an OfflineAudioContext,
// every step of the song scheduled up front (with swing), plus a 3 s tail.
import { SPB, audible, planStep, songEnd, stepDur, swingOffset, type Song } from "@thk/song";
import { Engine, type BufferLookup } from "./engine.ts";

export interface OfflineContextLike extends BaseAudioContext {
  startRendering(): Promise<AudioBuffer>;
}
export type OfflineFactory = (channels: number, length: number, sampleRate: number) => OfflineContextLike;

const browserFactory: OfflineFactory = (ch, len, sr) => new OfflineAudioContext(ch, len, sr);

export const RENDER_START = 0.02;
export const RENDER_TAIL = 3;

export interface RenderOptions {
  sampleRate?: number;
  createContext?: OfflineFactory;
  random?: () => number;
}

export async function renderOffline(song: Song, buffers: BufferLookup, o: RenderOptions = {}): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? 44100,
    sd = stepDur(song),
    total = songEnd(song) * SPB;
  let dur = total * sd + RENDER_TAIL;
  // Pad phrases and long cymbals ring freely after the last clip. Keep their audio and reverb.
  for (let step = 0; step < total; step++) {
    const time = RENDER_START + step * sd + swingOffset(song, step);
    for (const trigger of planStep(song, step).triggers) {
      if (trigger.steps != null || !audible(song, trigger.track)) continue;
      const selected = buffers.resolve?.(trigger.sample, trigger.rate, trigger.vel, 0);
      const buffer = selected?.buffer ?? buffers.get(trigger.sample);
      if (buffer) dur = Math.max(dur, time + buffer.duration / (selected?.rate ?? trigger.rate) + RENDER_TAIL);
    }
  }
  const oac = (o.createContext ?? browserFactory)(2, Math.ceil(dur * sr), sr);
  const eng = new Engine(oac, oac.destination, false, buffers, o.random);
  eng.sync(song);
  for (let s = 0; s < total; s++) eng.scheduleStep(song, s, RENDER_START + s * sd + swingOffset(song, s), sd);
  return oac.startRendering();
}
