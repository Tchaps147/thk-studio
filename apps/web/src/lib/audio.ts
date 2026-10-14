// The live audio side: one AudioContext, the sample bank, the engine and the transport.
// The engine follows the store's song; samples load lazily (the song's sounds first, a browser
// category when its tab opens, anything else on first audition).
import { Engine, SampleBank, Transport } from "@thk/audio";
import { ROOT, SPB, type Track } from "@thk/song";
import { get, setState, toast, useStudio } from "./store.ts";

type Ctor = typeof AudioContext;
let ctx: AudioContext | null = null;
let bank: SampleBank | null = null;
let engine: Engine | null = null;
let transport: Transport | null = null;

function init() {
  if (ctx) return;
  const AC: Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext;
  ctx = new AC({ latencyHint: "interactive" });
  bank = new SampleBank(ctx, import.meta.env.BASE_URL + "kit/");
  engine = new Engine(ctx, ctx.destination, true, bank);
  engine.sync(get().song);
  transport = new Transport(ctx, engine, () => get().song);
  transport.onChange(() => setState({ playing: transport!.playing }));
  void bank.loadSong(get().song);
  useStudio.subscribe((s, prev) => {
    if (s.song !== prev.song) {
      engine!.sync(s.song);
      void bank!.loadSong(s.song);
    }
  });
}

export function startAudio() {
  init();
}
export const audio = () => {
  init();
  return { ctx: ctx!, bank: bank!, engine: engine!, transport: transport! };
};

/** Resume a suspended context (browsers start it suspended until a user gesture). */
export function wake() {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

const now = () => audio().ctx.currentTime + 0.01;

async function playWhenLoaded(id: string, fn: () => void) {
  if (!audio().bank.has(id)) await audio().bank.load(id);
  fn();
}
export function auditionSample(id: string) {
  wake();
  void playWhenLoaded(id, () => audio().engine.trigger(null, id, now(), { choke: "aud" }));
}
export function auditionNote(tr: Track, p: number) {
  if (tr.type !== "synth") return;
  wake();
  const id = tr.sample;
  void playWhenLoaded(id, () =>
    audio().engine.trigger(tr, id, now(), { rate: 2 ** ((p - ROOT) / 12), end: now() + 0.35, choke: "aud" }),
  );
}
export function auditionPad(tr: Track, r: number) {
  if (tr.type !== "drums") return;
  const id = tr.pads[r];
  if (!id) return;
  wake();
  void playWhenLoaded(id, () => audio().engine.trigger(tr, id, now(), { choke: "aud" }));
}

// ---------- transport ----------
export async function play() {
  wake();
  const { transport, bank } = audio();
  await bank.loadSong(get().song);
  if (!transport.play()) toast("Draw a clip first: drag across bars in a track lane.");
}
export function stop() {
  audio().transport.stop();
}
export const togglePlay = () => (get().playing ? stop() : void play());
export function seek(step: number) {
  audio().transport.seek(step);
}
export const playPos = () => (transport ? transport.frame() : 0);
/** Start of the loop, or the song. */
export function returnToStart() {
  const s = get().song;
  seek(s.loop.on ? s.loop.start * SPB : 0);
}
