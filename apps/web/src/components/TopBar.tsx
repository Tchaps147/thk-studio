import { useRef } from "react";
import { fmtPos } from "@thk/audio";
import { NOTE_NAMES, clamp, songEnd } from "@thk/song";
import { returnToStart, togglePlay } from "../lib/audio.ts";
import { setKey, setSongProp, toggleLoop } from "../lib/actions.ts";
import { usePlayhead } from "../lib/playhead.ts";
import { redo, undo, useStudio } from "../lib/store.ts";

export function TopBar({ onNew, onExport }: { onNew: () => void; onExport: () => void }) {
  const song = useStudio((s) => s.song);
  const playing = useStudio((s) => s.playing);
  const canUndo = useStudio((s) => s.history.past.length > 0 || s.pending != null);
  const canRedo = useStudio((s) => s.history.future.length > 0);
  const status = useStudio((s) => s.status);
  const pos = useRef<HTMLElement>(null);
  usePlayhead((p) => {
    if (pos.current) pos.current.textContent = fmtPos(p);
  });
  const end = songEnd(song);

  return (
    <div className="topbar">
      <span className="brand">THK Studio</span>
      <div className="group">
        <button
          className="btn primary"
          id="playBtn"
          aria-pressed={playing}
          title="Play / stop (Space)"
          onClick={togglePlay}
        >
          <span className="dot"></span>
          <span id="playLbl">{playing ? "Stop" : "Play"}</span>
        </button>
        <button
          className="btn"
          id="rtzBtn"
          title="Back to start (Home)"
          aria-label="Back to start"
          onClick={returnToStart}
        >
          ⏮
        </button>
        <button
          className="btn toggle"
          id="loopBtn"
          aria-pressed={song.loop.on}
          title="Loop the marked bars (L). Drag along the bar ruler to set the loop."
          onClick={toggleLoop}
        >
          Loop
        </button>
      </div>
      <span className="lcd">
        <b id="posOut" ref={pos}>
          1.1.1
        </b>
        <span className="dim" id="lenOut">
          {end ? `${end} bar${end === 1 ? "" : "s"}` : "empty"}
        </span>
      </span>
      <label className="field">
        <span className="label">BPM</span>
        <input
          id="bpm"
          type="number"
          min={80}
          max={170}
          step={1}
          key={"bpm" + song.bpm}
          defaultValue={song.bpm}
          onBlur={(e) => commitBpm(e.currentTarget)}
          onKeyDown={(e) => e.key === "Enter" && commitBpm(e.currentTarget)}
        />
      </label>
      <label className="field">
        <span className="label">Key</span>
        <select id="keySel" aria-label="Song key" value={song.key} onChange={(e) => setKey(+e.target.value)}>
          {NOTE_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Swing</span>
        <input
          id="swing"
          type="range"
          min={50}
          max={66}
          step={1}
          value={song.swing}
          onChange={(e) => setSongProp("swing", +e.target.value, "swing")}
        />
        <output id="swingOut">{song.swing}%</output>
      </label>
      <span className="spacer"></span>
      <input
        className="song-name"
        id="songName"
        aria-label="Song name"
        key={"name" + song.name}
        defaultValue={song.name}
        onBlur={(e) => commitName(e.currentTarget)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <div className="group">
        <button className="btn" id="undoBtn" title="Undo (Ctrl/⌘+Z)" disabled={!canUndo} onClick={undo}>
          Undo
        </button>
        <button className="btn" id="redoBtn" title="Redo (Shift+Ctrl/⌘+Z)" disabled={!canRedo} onClick={redo}>
          Redo
        </button>
        <button className="btn" id="newBtn" onClick={onNew}>
          New
        </button>
        <button className="btn" id="exportBtn" onClick={onExport}>
          Export
        </button>
      </div>
      <span className="status" id="status">
        {status}
      </span>
    </div>
  );
}

function commitBpm(el: HTMLInputElement) {
  const v = clamp(Math.round(+el.value) || 125, 80, 170);
  el.value = String(v);
  if (v !== useStudio.getState().song.bpm) setSongProp("bpm", v);
}
function commitName(el: HTMLInputElement) {
  const v = el.value.trim() || "Untitled song";
  if (v !== useStudio.getState().song.name) setSongProp("name", v);
  else el.value = v;
}
