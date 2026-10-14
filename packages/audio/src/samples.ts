// Sample loading: fetched from /kit (later a CDN), decoded lazily and cached in memory.
import { BY_ID, KIT, type Song, type SoundKind } from "@thk/song";
import type { BufferLookup } from "./engine.ts";

export interface Decoder {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}
export type Fetcher = (url: string) => Promise<ArrayBuffer>;

const defaultFetch: Fetcher = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
};

export class SampleBank implements BufferLookup {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly failed = new Set<string>();

  constructor(
    private readonly decoder: Decoder,
    private readonly baseUrl = "/kit/",
    private readonly fetcher: Fetcher = defaultFetch,
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

  /** Loads one sound (once); resolves undefined if it can't be fetched or decoded. */
  load(id: string): Promise<AudioBuffer | undefined> {
    const have = this.buffers.get(id);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(id);
    if (!p) {
      if (!BY_ID[id] || this.failed.has(id)) return Promise.resolve(undefined);
      p = this.fetcher(this.baseUrl + id + ".wav")
        .then((data) => this.decoder.decodeAudioData(data))
        .then((b) => {
          this.buffers.set(id, b);
          return b;
        })
        .catch(() => {
          this.failed.add(id);
          return undefined;
        })
        .finally(() => this.pending.delete(id));
      this.pending.set(id, p);
    }
    return p;
  }

  loadAll(ids: Iterable<string | null | undefined>) {
    const uniq = [...new Set([...ids].filter((x): x is string => !!x))];
    return Promise.all(uniq.map((id) => this.load(id)));
  }
  loadKind(kind: SoundKind) {
    return this.loadAll(KIT.filter((s) => s.kind === kind).map((s) => s.id));
  }
  /** Every sound a song can play: all pads of drum tracks and each synth track's sample. */
  loadSong(song: Song) {
    return this.loadAll(soundsUsed(song));
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
