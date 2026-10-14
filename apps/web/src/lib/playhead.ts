// One requestAnimationFrame loop while playing. It only reads the position from the transport
// (which reads the audio clock); components subscribe and move their playheads directly in the DOM.
import { useEffect, useState } from "react";
import { audio, playPos } from "./audio.ts";
import { useStudio } from "./store.ts";

type Listener = (pos: number) => void;
const listeners = new Set<Listener>();
let raf = 0;

const emit = () => {
  const p = playPos();
  listeners.forEach((f) => f(p));
};
function loop() {
  emit();
  raf = useStudio.getState().playing ? requestAnimationFrame(loop) : 0;
}

export function startPlayheadLoop() {
  useStudio.subscribe((s, prev) => {
    if (s.playing && !prev.playing && !raf) raf = requestAnimationFrame(loop);
    if (!s.playing) emit();
  });
  audio().transport.onChange(emit);
}

/** Calls fn with the playhead position every frame while playing, and once on (un)subscribe changes. */
export function usePlayhead(fn: Listener, deps: unknown[] = []) {
  useEffect(() => {
    listeners.add(fn);
    fn(playPos());
    return () => {
      listeners.delete(fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Bumps when canvases should redraw: colour scheme or theme attribute changes, or a resize. */
export function useRedrawKey(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN((x) => x + 1);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(bump, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      mq.removeEventListener("change", bump);
      mo.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return n;
}

/** Sets a canvas to its CSS size at device resolution and returns a scaled 2D context. */
export function fitCanvas(cv: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = cv.clientWidth,
    h = cv.clientHeight,
    dpr = window.devicePixelRatio || 1;
  if (!w || !h) return null;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  if (!g) return null;
  g.scale(dpr, dpr);
  return { g, w, h };
}
export const cssVar = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();
