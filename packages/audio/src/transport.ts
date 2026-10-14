// Live playback (HANDOFF.md 4.4): a lookahead scheduler on the audio clock. Every 25 ms it
// schedules each 16th that starts within the next 120 ms; the playhead is interpolated from
// [audioTime, step] anchors so visuals follow the audio clock, not timers.
import { SPB, songEnd, stepDur, swingOffset, type Song } from "@thk/song";
import type { Engine } from "./engine.ts";

const LOOKAHEAD = 0.12,
  INTERVAL = 25;

export class Transport {
  playing = false;
  /** Position in steps (fractional) while stopped; updated by frame() while playing. */
  pos = 0;
  private step = 0;
  private next = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private anchors: [number, number][] = [];
  private listeners = new Set<() => void>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly engine: Engine,
    private readonly getSong: () => Song,
  ) {}

  /** Called when playing starts or stops (not on every frame). */
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  /** Starts from pos. Returns false when there is nothing to play. */
  play(): boolean {
    const song = this.getSong();
    this.engine.sync(song);
    const end = songEnd(song);
    if (!end) return false;
    this.playing = true;
    this.step = Math.floor(this.pos);
    if (song.loop.on && (this.step < song.loop.start * SPB || this.step >= song.loop.end * SPB))
      this.step = song.loop.start * SPB;
    if (!song.loop.on && this.step >= end * SPB) this.step = 0;
    this.next = this.ctx.currentTime + 0.06;
    this.anchors = [];
    this.timer = setInterval(() => this.pump(), INTERVAL);
    this.pump();
    this.emit();
    return true;
  }

  stop() {
    this.pos = this.currentPos();
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.engine.stopAll();
    this.emit();
  }

  /** Jumps to a step; while playing, cuts what sounds and continues from there. */
  seek(step: number) {
    this.pos = Math.max(0, step);
    if (this.playing) {
      this.engine.stopAll();
      this.step = Math.floor(this.pos);
      this.next = this.ctx.currentTime + 0.04;
      this.anchors = [];
      if (!this.timer) this.timer = setInterval(() => this.pump(), INTERVAL);
    }
    this.emit();
  }

  private pump() {
    const song = this.getSong(),
      sd = stepDur(song),
      total = songEnd(song) * SPB;
    while (this.next < this.ctx.currentTime + LOOKAHEAD) {
      if (song.loop.on && this.step >= song.loop.end * SPB) this.step = song.loop.start * SPB;
      if (!song.loop.on && this.step >= total) {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        const wait = (this.next - this.ctx.currentTime) * 1000 + 80;
        setTimeout(() => {
          if (this.playing && !this.timer) {
            this.stop();
            this.pos = 0;
            this.emit();
          }
        }, wait);
        break;
      }
      this.engine.scheduleStep(song, this.step, this.next + swingOffset(song, this.step), sd);
      this.anchors.push([this.next, this.step]);
      if (this.anchors.length > 96) this.anchors.shift();
      this.next += sd;
      this.step++;
    }
  }

  /** The step under the playhead now, read from the audio clock. */
  currentPos(): number {
    if (!this.playing) return this.pos;
    const t = this.ctx.currentTime,
      sd = stepDur(this.getSong());
    let a: [number, number] | null = null;
    for (const x of this.anchors) {
      if (x[0] <= t) a = x;
      else break;
    }
    if (!a) return this.pos;
    return a[1] + Math.min(0.999, (t - a[0]) / sd);
  }

  /** Call once per animation frame while playing; returns the position. */
  frame(): number {
    if (this.playing) this.pos = this.currentPos();
    return this.pos;
  }
}

export const fmtPos = (p: number) =>
  `${Math.floor(p / 16) + 1}.${Math.floor((p % 16) / 4) + 1}.${Math.floor(p % 4) + 1}`;
