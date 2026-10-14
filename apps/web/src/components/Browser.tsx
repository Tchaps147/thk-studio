import { useEffect, useRef, useState } from "react";
import { BY_ID, CATS, KIT, sampleNum, trackById, type Sound } from "@thk/song";
import { assign } from "../lib/actions.ts";
import { audio, auditionSample } from "../lib/audio.ts";
import { cssVar, fitCanvas, useRedrawKey } from "../lib/playhead.ts";
import { setUi, useStudio } from "../lib/store.ts";

export function Browser() {
  const tab = useStudio((s) => s.ui.tab);
  const items = KIT.filter((k) => k.kind === tab);
  useEffect(() => {
    void audio().bank.loadKind(tab);
  }, [tab]);
  return (
    <aside className="panel browser" data-testid="browser">
      <div className="panel-head">
        <h2>Sounds</h2>
        <span className="label" id="catCount">
          {items.length} sounds
        </span>
      </div>
      <div className="cat-tabs" id="tabs" role="group" aria-label="Sound category">
        {CATS.map(([k, plural]) => (
          <button key={k} aria-pressed={k === tab} onClick={() => setUi({ tab: k })}>
            {plural}
          </button>
        ))}
      </div>
      <Target />
      <div className="blist" id="blist">
        {items.map((s) => (
          <Item key={s.id} s={s} />
        ))}
      </div>
    </aside>
  );
}

function Target() {
  const tr = useStudio((s) => trackById(s.song, s.sel.tid));
  const row = useStudio((s) => s.sel.row);
  if (!tr)
    return (
      <div className="target" id="target">
        Select a track to choose where Use sends a sound.
      </div>
    );
  if (tr.type === "synth")
    return (
      <div className="target" id="target">
        Use sends a sound to <b>{tr.name}</b>.
      </div>
    );
  const cur = BY_ID[tr.pads[row] ?? ""];
  return (
    <div className="target" id="target">
      Use sends a sound to <b>{`${tr.name}, pad ${row + 1}`}</b>
      {cur ? ` (now ${cur.name}).` : "."}
    </div>
  );
}

function Item({ s }: { s: Sound }) {
  const [hit, setHit] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const redraw = useRedrawKey();
  useEffect(() => {
    const c = cv.current && fitCanvas(cv.current);
    if (!c) return;
    const { g, w, h } = c;
    g.fillStyle = cssVar(document.body, "--ink-soft") || "#888";
    const bw = w / s.peaks.length;
    s.peaks.forEach((m, i) => {
      const bh = Math.max(1, m * h);
      g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.6), bh);
    });
  }, [s, redraw]);
  return (
    <div className="item">
      <button
        className={"item-play" + (hit ? " hit" : "")}
        title={"Play " + s.name}
        onClick={() => {
          auditionSample(s.id);
          setHit(true);
          setTimeout(() => setHit(false), 140);
        }}
      >
        <span className="num">{sampleNum(s)}</span>
        <span className="item-name">{s.name}</span>
        <span className="item-meta">
          {(s.kind === "kick" ? "key " + s.note + " · " : s.kind === "bass" ? "root C · " : "") +
            s.dur.toFixed(2) +
            " s"}
        </span>
        <canvas aria-hidden="true" ref={cv} data-id={s.id}></canvas>
      </button>
      <button className="use" title="Put this sound on the selected track or pad" onClick={() => assign(s.id)}>
        Use
      </button>
    </div>
  );
}
