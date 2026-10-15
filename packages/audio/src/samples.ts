// Sample loading: kit sounds are fetched from /kit (later a CDN) and decoded; patch sounds (factory
// presets and the user's own) are rendered. Everything is lazy and cached in memory; a patch
// re-renders when its settings change.
import { KIT, patchHash, soundOf, type Song, type Sound, type SoundKind } from "@thk/song";
import type { BufferLookup } from "./engine.ts";
import { renderPatch, type RenderPatchOptions } from "./synth.ts";

export interface Decoder {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}
export type Fetcher = (url: string) => Promise<ArrayBuffer>;
export type PatchRenderer = (sound: Sound, opts: RenderPatchOptions) => Promise<AudioBuffer>;

const defaultFetch: Fetcher = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
};
const defaultRender: PatchRenderer = (s, opts) => renderPatch(s.patch!, opts);

export class SampleBank implements BufferLookup {
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Patch hash each rendered buffer was made from. */
  private readonly rendered = new Map<string, string>();
  private readonly pending = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<(id: string) => void>();

  constructor(
    private readonly decoder: Decoder,
    private readonly baseUrl = "/kit/",
    private readonly fetcher: Fetcher = defaultFetch,
    private readonly render: PatchRenderer = defaultRender,
    private readonly renderOptions: RenderPatchOptions = {},
  ) {}

  get(id: string) {
    return this.buffers.get(id);
  }
  has(id: string) {
    return this.buffers.has(id);
  }
  get size() {
    return this.buffers.size;
  }
  /** Called whenever a sound finishes loading or rendering. */
  onLoad(fn: (id: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Loads one sound (once); resolves undefined if it can't be fetched, decoded or rendered. */
  load(id: string, song?: Song): Promise<AudioBuffer | undefined> {
    const s = soundOf(song, id);
    if (!s) return Promise.resolve(undefined);
    return this.loadSound(s, song);
  }

  /** Loads a sound object directly: the sound maker's unsaved draft, or a song's own sound. */
  loadSound(s: Sound, song?: Song): Promise<AudioBuffer | undefined> {
    const hash = s.patch ? patchHash(s.patch) : "file";
    const have = this.buffers.get(s.id);
    if (have && this.rendered.get(s.id) === hash) return Promise.resolve(have);
    const key = s.id + ":" + hash;
    let p = this.pending.get(key);
    if (p) return p;
    if (!s.patch && this.failed.has(s.id)) return Promise.resolve(undefined);
    p = (
      s.patch
        ? this.renderSound(s, song)
        : this.fetcher(this.baseUrl + s.id + ".wav").then((d) => this.decoder.decodeAudioData(d))
    )
      .then((b) => {
        this.buffers.set(s.id, b);
        this.rendered.set(s.id, hash);
        this.listeners.forEach((f) => f(s.id));
        return b;
      })
      .catch(() => {
        if (!s.patch) this.failed.add(s.id);
        return undefined;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  private async renderSound(s: Sound, song?: Song): Promise<AudioBuffer> {
    const src = s.patch!.engine === "sample" && s.patch!.source ? await this.load(s.patch!.source, song) : undefined;
    return this.render(s, { ...this.renderOptions, ...(src ? { source: src } : {}) });
  }

  loadAll(ids: Iterable<string | null | undefined>, song?: Song) {
    const uniq = [...new Set([...ids].filter((x): x is string => !!x))];
    return Promise.all(uniq.map((id) => this.load(id, song)));
  }
  loadKind(kind: SoundKind, song?: Song) {
    return this.loadAll(
      KIT.filter((s) => s.kind === kind)
        .map((s) => s.id)
        .concat((song?.sounds ?? []).filter((s) => s.kind === kind).map((s) => s.id)),
      song,
    );
  }
  /** Every sound a song can play: all pads of drum tracks and each synth track's sample. */
  loadSong(song: Song) {
    return this.loadAll(soundsUsed(song), song);
  }
}

export function soundsUsed(song: Song): string[] {
  const ids = new Set<string>();
  for (const t of song.tracks) {
    if (t.type === "drums") t.pads.forEach((p) => p && ids.add(p));
    else ids.add(t.sample);
  }
  return [...ids];
}
