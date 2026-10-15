// The audio graph (HANDOFF.md 4.3). One class for live playback and offline export.
//
// Per track: source -> note gain -> lowpass -> duck gain -> volume -> panner -> master,
// plus panner -> send -> convolver reverb -> master.
// Master: gain 0.85 -> compressor (-10 dB, 6:1) -> destination.
import { audible, planStep, type Song, type Track } from "@thk/song";

export interface BufferLookup {
  get(id: string): AudioBuffer | undefined;
  resolve?(id: string, rate: number, velocity: number, take: number): { buffer: AudioBuffer; rate: number } | undefined;
}

export interface TriggerOptions {
  /** playbackRate (2^(semitones/12)). */
  rate?: number;
  vel?: number;
  /** Gate end time: hold until then, then a 25 ms release. */
  end?: number;
  /** Voices with the same choke key on the same track cut each other (6 ms fade). */
  choke?: string | null;
}

interface TrackNodes {
  filter: BiquadFilterNode;
  duck: GainNode;
  vol: GainNode;
  pan: StereoPannerNode;
  send: GainNode;
}
interface Voice {
  src: AudioBufferSourceNode;
  g: GainNode;
  v: number;
  endAt: number;
}

/** Decaying stereo noise for the convolution reverb. */
export function makeImpulse(ac: BaseAudioContext, secs: number, random: () => number = Math.random): AudioBuffer {
  const len = Math.floor(ac.sampleRate * secs),
    b = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return b;
}

/** Volume fader law: vol² × 1.2. */
export const faderGain = (vol: number) => vol * vol * 1.2;

export class Engine {
  readonly out: GainNode;
  readonly preview: GainNode;
  private readonly verb: ConvolverNode;
  private readonly tn = new Map<string, TrackNodes>();
  private readonly voices = new Map<string, Voice>();
  private readonly active = new Set<AudioBufferSourceNode>();
  private readonly takes = new Map<string, number>();
  private song: Song | null = null;

  constructor(
    readonly ac: BaseAudioContext,
    dest: AudioNode,
    /** Live: smoothed parameter changes and voice tracking for stop. Offline: immediate values. */
    readonly live: boolean,
    private readonly buffers: BufferLookup,
    random: () => number = Math.random,
  ) {
    this.out = ac.createGain();
    this.out.gain.value = 0.85;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    this.out.connect(comp);
    comp.connect(dest);
    this.verb = ac.createConvolver();
    this.verb.buffer = makeImpulse(ac, 2.2, random);
    const ret = ac.createGain();
    ret.gain.value = 0.7;
    this.verb.connect(ret);
    ret.connect(this.out);
    this.preview = ac.createGain();
    this.preview.gain.value = 0.8;
    this.preview.connect(this.out);
  }

  private nodes(tr: Track): TrackNodes {
    let n = this.tn.get(tr.id);
    if (!n) {
      const a = this.ac;
      n = {
        filter: a.createBiquadFilter(),
        duck: a.createGain(),
        vol: a.createGain(),
        pan: a.createStereoPanner(),
        send: a.createGain(),
      };
      n.filter.type = "lowpass";
      n.filter.Q.value = 0.8;
      n.filter.connect(n.duck);
      n.duck.connect(n.vol);
      n.vol.connect(n.pan);
      n.pan.connect(this.out);
      n.pan.connect(n.send);
      n.send.connect(this.verb);
      this.tn.set(tr.id, n);
      this.apply(tr, n, this.song ? audible(this.song, tr) : !tr.mute);
    }
    return n;
  }

  private apply(tr: Track, n: TrackNodes, isAudible: boolean) {
    const set = (param: AudioParam, v: number) => {
      if (this.live) param.setTargetAtTime(v, this.ac.currentTime, 0.015);
      else param.value = v;
    };
    set(n.vol.gain, isAudible ? faderGain(tr.vol) : 0);
    set(n.pan.pan, tr.pan || 0);
    set(n.filter.frequency, tr.cutoff || 20000);
    set(n.send.gain, tr.send || 0);
  }

  /** Brings every track's mix in line with the song; drops nodes of deleted tracks. */
  sync(song: Song) {
    this.song = song;
    const ids = new Set(song.tracks.map((t) => t.id));
    for (const t of song.tracks) this.apply(t, this.nodes(t), audible(song, t));
    for (const [id, n] of this.tn)
      if (!ids.has(id)) {
        n.pan.disconnect();
        n.send.disconnect();
        this.tn.delete(id);
      }
  }

  /** Starts one voice. tr = null plays through the preview bus (auditioning in the browser). */
  trigger(tr: Track | null, sampleId: string, time: number, o: TriggerOptions = {}) {
    const v = o.vel ?? 1,
      requestedRate = o.rate || 1;
    const key = `${tr?.id ?? "preview"}:${sampleId}:${Math.round(12 * Math.log2(requestedRate))}`;
    const take = this.takes.get(key) ?? 0;
    const resolved = this.buffers.resolve?.(sampleId, requestedRate, v, take);
    const buf = resolved?.buffer ?? this.buffers.get(sampleId);
    if (!buf) return;
    if (resolved) this.takes.set(key, take + 1);
    const rate = resolved?.rate ?? requestedRate;
    const dest = tr ? this.nodes(tr).filter : this.preview;
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(v, time);
    src.connect(g);
    g.connect(dest);
    if (o.choke) {
      const key = (tr ? tr.id : "preview") + ":" + o.choke,
        prev = this.voices.get(key);
      if (prev && prev.endAt > time) {
        prev.g.gain.cancelScheduledValues(time);
        prev.g.gain.setValueAtTime(prev.v, time);
        prev.g.gain.linearRampToValueAtTime(0, time + 0.006);
        try {
          prev.src.stop(time + 0.01);
        } catch {
          /* already stopped */
        }
      }
      this.voices.set(key, { src, g, v, endAt: o.end ? o.end + 0.03 : time + buf.duration / rate });
    }
    src.start(time);
    if (o.end) {
      g.gain.setValueAtTime(v, Math.max(time, o.end - 0.002));
      g.gain.linearRampToValueAtTime(0, o.end + 0.025);
      src.stop(o.end + 0.03);
    }
    if (this.live) {
      this.active.add(src);
      src.onended = () => this.active.delete(src);
    }
  }

  /** Sidechain: dip to 0.3 in 8 ms, back to 1 by 190 ms. */
  duck(tr: Track, time: number) {
    const g = this.nodes(tr).duck.gain;
    g.setValueAtTime(1, time);
    g.linearRampToValueAtTime(0.3, time + 0.008);
    g.linearRampToValueAtTime(1, time + 0.19);
  }

  /** Schedules everything that plays at one step. stepSecs is the length of a 16th. */
  scheduleStep(song: Song, step: number, time: number, stepSecs: number) {
    const plan = planStep(song, step);
    for (const t of plan.triggers)
      this.trigger(t.track, t.sample, time, {
        vel: t.vel,
        rate: t.rate,
        choke: t.choke,
        ...(t.steps == null ? {} : { end: time + t.steps * stepSecs }),
      });
    for (const d of plan.ducks) this.duck(d, time);
  }

  stopAll() {
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
    this.voices.clear();
    this.takes.clear();
    for (const n of this.tn.values()) {
      n.duck.gain.cancelScheduledValues(0);
      n.duck.gain.value = 1;
    }
  }
}
