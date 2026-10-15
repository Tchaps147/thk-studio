import { useEffect, useRef, useState } from "react";
import { peaksOf } from "@thk/audio";
import { CATS, KIT, sampleNum, soundOf, trackById, type Sound } from "@thk/song";
import { assign, openMaker } from "../lib/actions.ts";
import { audio, auditionSample } from "../lib/audio.ts";
import { cssVar, fitCanvas, useRedrawKey } from "../lib/playhead.ts";
import { setUi, useStudio } from "../lib/store.ts";

export function Browser() {
  const tab = useStudio((s) => s.ui.tab);
  const song = useStudio((s) => s.song);
  const library = useStudio((s) => s.library);
  const items = KIT.filter((k) => k.kind === tab);
  const mine = (song.sounds ?? [])
    .filter((s) => s.kind === tab)
    .concat(library.filter((s) => s.kind === tab && !soundOf(song, s.id)));
  useEffect(() => {
    void audio().bank.loadKind(tab, useStudio.getState().song);
  }, [tab]);
  return (
    <aside className="panel browser" data-testid="browser">
      <div className="panel-head">
        <h2>Sounds</h2>
        <span className="label" id="catCount">
          {items.length} sounds
        </span>
        <button className="mini new-sound" title="Make a new sound in the sound maker" onClick={() => openMaker(tab)}>
          + New sound
        </button>
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
        {mine.length > 0 && <span className="label mine">My sounds</span>}
        {mine.map((s) => (
          <Item key={s.id} s={s} />
        ))}
        {mine.length > 0 && <span className="label mine">Built in</span>}
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
  const cur = soundOf(useStudio.getState().song, tr.pads[row]);
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
  // Patch sounds have no stored waveform: draw it once the bank has rendered them.
  const [peaks, setPeaks] = useState(s.peaks);
  useEffect(() => {
    if (!s.patch) return;
    const { bank } = audio();
    const take = () => {
      const b = bank.get(s.id);
      if (b) setPeaks(peaksOf(b));
    };
    take();
    const off = bank.onLoad((id) => {
      if (id === s.id) take();
    });
    return () => {
      off();
    };
  }, [s]);
  useEffect(() => {
    const c = cv.current && fitCanvas(cv.current);
    if (!c || !peaks.length) return;
    const { g, w, h } = c;
    g.fillStyle = cssVar(document.body, "--ink-soft") || "#888";
    const bw = w / peaks.length;
    peaks.forEach((m, i) => {
      const bh = Math.max(1, m * h);
      g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.6), bh);
    });
  }, [peaks, redraw]);
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
        <span className="num">{s.custom ? "★" : sampleNum(s)}</span>
        <span className="item-name">{s.name}</span>
        <span className="item-meta">
          {(s.custom ? "mine · " : s.patch ? "synth · " : "") +
            (s.kind === "kick" && s.note ? "key " + s.note + " · " : s.kind === "bass" && !s.patch ? "root C · " : "") +
            s.dur.toFixed(2) +
            " s"}
        </span>
        <canvas aria-hidden="true" ref={cv} data-id={s.id}></canvas>
      </button>
      <div className="acts2">
        <button className="use" title="Put this sound on the selected track or pad" onClick={() => assign(s.id)}>
          Use
        </button>
        <button
          className="use edit"
          title={s.custom ? "Edit this sound in the sound maker" : "Make your own version of this sound"}
          onClick={() => openMaker(s.kind, s)}
        >
          {s.custom ? "Edit" : "Copy"}
        </button>
      </div>
    </div>
  );
}
