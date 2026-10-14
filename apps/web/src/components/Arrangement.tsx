import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { SPB, clamp, displayBars, overlaps, songEnd, trackById, type Clip, type Track } from "@thk/song";
import { addTrack, deleteTrack, drawClip, setLoop, setTrackProp } from "../lib/actions.ts";
import { seek } from "../lib/audio.ts";
import { cssVar, fitCanvas, usePlayhead, useRedrawKey } from "../lib/playhead.ts";
import {
  beginGesture,
  cancelGesture,
  endGesture,
  get,
  select,
  setUi,
  toast,
  updateGesture,
  useStudio,
} from "../lib/store.ts";
import { ArmButton } from "./ArmButton.tsx";

export function Arrangement() {
  const ppb = useStudio((s) => s.ui.ppb);
  const follow = useStudio((s) => s.ui.follow);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Arrangement</h2>
        <div className="group">
          <label className="ctl">
            <span className="label">Zoom</span>
            <input
              id="arrZoom"
              type="range"
              min={16}
              max={120}
              step={2}
              value={ppb}
              aria-label="Arrangement zoom"
              onChange={(e) => setUi({ ppb: +e.target.value })}
            />
          </label>
          <label className="ctl">
            <input id="follow" type="checkbox" checked={follow} onChange={(e) => setUi({ follow: e.target.checked })} />{" "}
            Follow playhead
          </label>
          <button className="btn" id="addDrums" title="Add a drum track" onClick={() => addTrack("drums")}>
            + Drum track
          </button>
          <button className="btn" id="addSynth" title="Add a synth track" onClick={() => addTrack("synth")}>
            + Synth track
          </button>
        </div>
      </div>
      <Grid />
      <p className="hint">
        Drag across bars in a lane to draw a clip. Drag a clip to move it, drag its right edge to make it longer (the
        pattern repeats). Drag along the bar numbers to set a loop, click them to jump.
      </p>
    </section>
  );
}

function Grid() {
  const song = useStudio((s) => s.song);
  const ppb = useStudio((s) => s.ui.ppb);
  const bars = displayBars(song);
  const end = songEnd(song);
  const scroll = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const ph = useRef<HTMLDivElement>(null);
  usePlayhead(
    (pos) => {
      const hw = head.current?.offsetWidth ?? 0,
        x = hw + (pos / SPB) * ppb;
      if (ph.current) ph.current.style.transform = `translateX(${x}px)`;
      const sc = scroll.current,
        s = get();
      if (sc && s.playing && s.ui.follow) {
        const l = sc.scrollLeft + hw,
          r = sc.scrollLeft + sc.clientWidth;
        if (x < l || x > r - 30) sc.scrollLeft = x - hw - 30;
      }
    },
    [ppb],
  );
  return (
    <div className="arr-scroll" id="arrScroll" ref={scroll}>
      <div className="arr-grid" id="arrGrid" style={{ ["--bars" as string]: bars, ["--ppb" as string]: ppb + "px" }}>
        <div className="corner" ref={head}>
          <span className="label">Tracks</span>
        </div>
        <Ruler bars={bars} ppb={ppb} />
        {song.tracks.map((tr) => [
          <TrackHead key={"h" + tr.id} tr={tr} />,
          <Lane key={"l" + tr.id} tr={tr} ppb={ppb} />,
        ])}
        {song.loop.on && (
          <div
            className="loopshade"
            style={{ ["--ls" as string]: song.loop.start, ["--le" as string]: song.loop.end }}
          ></div>
        )}
        {end > 0 && (
          <div
            className="endmark"
            title="End of song"
            style={{ left: `calc(var(--head-w) + ${end} * var(--ppb))` }}
          ></div>
        )}
        <div className="playhead" id="arrPlayhead" ref={ph}></div>
      </div>
    </div>
  );
}

function Ruler({ bars, ppb }: { bars: number; ppb: number }) {
  const loop = useStudio((s) => s.song.loop);
  const [band, setBand] = useState<{ s: number; e: number } | null>(null);
  const every = ppb < 26 ? 4 : 1;
  const nums = [];
  for (let b = 0; b < bars; b += every)
    nums.push(
      <span key={b} className="bar-num" style={{ left: b * ppb }}>
        {b + 1}
      </span>,
    );
  const onDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget,
      r = el.getBoundingClientRect();
    const toBar = (x: number) => clamp(Math.round(((x - r.left) / ppb) * 4) / 4, 0, bars);
    const b0 = toBar(e.clientX);
    let b1 = b0;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      b1 = toBar(ev.clientX);
      if (Math.abs(b1 - b0) >= 1) setBand({ s: Math.floor(Math.min(b0, b1)), e: Math.ceil(Math.max(b0, b1)) });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setBand(null);
      if (Math.abs(b1 - b0) >= 1) setLoop(Math.floor(Math.min(b0, b1)), Math.ceil(Math.max(b0, b1)));
      else seek(b0 * SPB);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const shown = band ?? { s: loop.start, e: loop.end };
  return (
    <div className="ruler" onPointerDown={onDown} data-testid="ruler">
      {nums}
      <div
        className={"loopband" + (loop.on || band ? " on" : "")}
        id="loopband"
        style={{ left: shown.s * ppb, width: (shown.e - shown.s) * ppb }}
      ></div>
    </div>
  );
}

function TrackHead({ tr }: { tr: Track }) {
  const selected = useStudio((s) => s.sel.tid === tr.id);
  return (
    <div
      className={"thead" + (selected ? " sel" : "")}
      style={{ ["--c" as string]: `var(--t${tr.color})` }}
      data-tid={tr.id}
      onPointerDown={(e) => {
        if (!(e.target as Element).closest("button,input")) select({ tid: tr.id });
      }}
    >
      <div className="thead-top">
        <input
          className="tname"
          aria-label="Track name"
          key={tr.name}
          defaultValue={tr.name}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== tr.name) setTrackProp(tr.id, "name", v, "Rename track");
            else e.currentTarget.value = tr.name;
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <button
          className={"tbtn" + (tr.mute ? " on" : "")}
          title="Mute"
          aria-pressed={tr.mute}
          onClick={() => setTrackProp(tr.id, "mute", !tr.mute, tr.mute ? "Unmute" : "Mute")}
        >
          M
        </button>
        <button
          className={"tbtn solo" + (tr.solo ? " on" : "")}
          title="Solo"
          aria-pressed={tr.solo}
          onClick={() => setTrackProp(tr.id, "solo", !tr.solo, "Solo")}
        >
          S
        </button>
      </div>
      <div className="thead-bot">
        <span className="ttype">{tr.type === "drums" ? "Drums" : "Synth"}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={tr.vol}
          aria-label={tr.name + " volume"}
          title="Volume"
          onChange={(e) => setTrackProp(tr.id, "vol", +e.target.value, "Volume", "vol:")}
        />
        <ArmButton className="tbtn x" title="Delete track" armedLabel="Delete?" onConfirm={() => deleteTrack(tr.id)}>
          ×
        </ArmButton>
      </div>
    </div>
  );
}

function Lane({ tr, ppb }: { tr: Track; ppb: number }) {
  const selected = useStudio((s) => s.sel.tid === tr.id);
  const [ghost, setGhost] = useState<{ b0: number; b1: number } | null>(null);
  const onDown = (e: RPE<HTMLDivElement>) => {
    const lane = e.currentTarget;
    if (e.target !== lane || e.button !== 0) return;
    if (get().sel.tid !== tr.id) select({ tid: tr.id });
    const r = lane.getBoundingClientRect(),
      b0 = Math.floor((e.clientX - r.left) / ppb);
    let b1 = b0;
    setGhost({ b0, b1 });
    lane.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      b1 = Math.max(b0, Math.floor((ev.clientX - r.left) / ppb));
      setGhost({ b0, b1 });
    };
    const up = () => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerup", up);
      lane.removeEventListener("pointercancel", up);
      setGhost(null);
      drawClip(tr.id, b0, b1);
    };
    lane.addEventListener("pointermove", move);
    lane.addEventListener("pointerup", up);
    lane.addEventListener("pointercancel", up);
  };
  return (
    <div
      className={"lane" + (selected ? " sel" : "")}
      style={{ ["--c" as string]: `var(--t${tr.color})` }}
      data-tid={tr.id}
      onPointerDown={onDown}
    >
      {tr.clips.map((c) => (
        <ClipView key={c.id} tr={tr} c={c} ppb={ppb} />
      ))}
      {ghost && (
        <div className="clip ghost" style={{ left: ghost.b0 * ppb, width: (ghost.b1 - ghost.b0 + 1) * ppb }}></div>
      )}
    </div>
  );
}

function ClipView({ tr, c, ppb }: { tr: Track; c: Clip; ppb: number }) {
  const selected = useStudio((s) => s.sel.cid === c.id);
  const cv = useRef<HTMLCanvasElement>(null);
  const redraw = useRedrawKey();
  useEffect(() => {
    const el = cv.current;
    if (el) paintClip(el, tr, c);
  }, [tr, c, ppb, redraw]);

  const onDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = get();
    if (s.sel.cid !== c.id) select({ tid: tr.id, cid: c.id });
    const el = e.currentTarget,
      edge = (e.target as Element).classList.contains("grip"),
      x0 = e.clientX,
      s0 = c.start,
      l0 = c.len;
    let started = false,
      last = { start: s0, len: l0 };
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const db = Math.round((ev.clientX - x0) / ppb);
      const nextPos = edge ? { start: s0, len: Math.max(1, l0 + db) } : { start: Math.max(0, s0 + db), len: l0 };
      if (nextPos.start === last.start && nextPos.len === last.len) return;
      last = nextPos;
      if (!started) {
        beginGesture();
        started = true;
      }
      updateGesture((d) => {
        const clip = d.tracks.find((t) => t.id === tr.id)?.clips.find((x) => x.id === c.id);
        if (clip) Object.assign(clip, nextPos);
      });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (!started) return;
      const t = trackById(get().song, tr.id),
        moved = t?.clips.find((x) => x.id === c.id);
      if (!t || !moved || (moved.start === s0 && moved.len === l0)) return cancelGesture();
      if (overlaps(t, moved)) {
        cancelGesture();
        toast("Clips on the same track can't overlap.");
        return;
      }
      endGesture(edge ? "Resize clip" : "Move clip");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <div
      className={"clip" + (selected ? " sel" : "")}
      data-cid={c.id}
      data-tid={tr.id}
      style={{ left: c.start * ppb, width: c.len * ppb }}
      title={(c.name || tr.name) + " · bars " + (c.start + 1) + "–" + (c.start + c.len)}
      onPointerDown={onDown}
      onDoubleClick={() =>
        document.getElementById("editorPanel")?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      }
    >
      <div className="clip-strip">{c.name || tr.name}</div>
      <canvas ref={cv}></canvas>
      <span className="grip"></span>
    </div>
  );
}

/** Mini view of a clip's notes: pattern repeats marked, drums one row per pad, synth by pitch. */
function paintClip(cv: HTMLCanvasElement, tr: Track, c: Clip) {
  const f = fitCanvas(cv);
  if (!f) return;
  const { g, w, h } = f;
  const L = c.loop * SPB,
    total = c.len * SPB,
    pps = w / total,
    col = cssVar(cv.parentElement!, "--c") || "#888";
  let lo: number, hi: number;
  if (tr.type === "drums") [lo, hi] = [0, 7];
  else [lo, hi] = [Math.min(...c.notes.map((n) => n.p), 48), Math.max(...c.notes.map((n) => n.p), 36)];
  const span = Math.max(1, hi - lo + 1),
    rowH = Math.max(1.5, (h - 6) / span);
  g.globalAlpha = 0.35;
  g.fillStyle = cssVar(document.body, "--ink-soft");
  for (let base = L; base < total; base += L) g.fillRect(base * pps, 0, 1, h);
  g.globalAlpha = 1;
  g.fillStyle = col;
  for (let base = 0; base < total; base += L)
    for (const n of c.notes) {
      if (n.t >= L || base + n.t >= total) continue;
      const y = tr.type === "drums" ? 3 + n.p * rowH : 3 + (hi - n.p) * rowH;
      g.fillRect(
        (base + n.t) * pps,
        y,
        Math.max(1.5, Math.min(n.d, total - base - n.t) * pps - 0.5),
        Math.max(1.5, rowH - 0.6),
      );
    }
}
