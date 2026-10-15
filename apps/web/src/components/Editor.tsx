import { useRef, type PointerEvent as RPE } from "react";
import {
  BASS_GROOVES,
  CATS,
  DRUM_GROOVES,
  FMAX,
  FMIN,
  HIGH,
  KIT,
  LOW,
  MELODIC,
  N,
  SPB,
  clamp,
  clipById,
  sampleLabel,
  soundOf,
  trackById,
  type Clip,
  type Note,
  type Song,
  type Track,
} from "@thk/song";
import {
  addClipAt,
  applyGrooveTo,
  clipEdit,
  deleteClip,
  duplicateClip,
  setPadSound,
  setSynthSound,
  setTrackProp,
  showLocalVariations,
} from "../lib/actions.ts";
import { auditionNote, auditionPad, playPos } from "../lib/audio.ts";
import { usePlayhead } from "../lib/playhead.ts";
import { beginGesture, endGesture, get, select, setUi, updateGesture, useStudio } from "../lib/store.ts";
import { ArmButton } from "./ArmButton.tsx";

const BLACK = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pname = (p: number) => NOTE_NAMES[((p % 12) + 12) % 12]! + (Math.floor(p / 12) - 1);
const cutToPos = (c: number) => Math.round((100 * Math.log(c / FMIN)) / Math.log(FMAX / FMIN));
const posToCut = (p: number) => Math.round(FMIN * Math.pow(FMAX / FMIN, p / 100));

export function Editor() {
  const tr = useStudio((s) => trackById(s.song, s.sel.tid));
  const c = useStudio((s) => clipById(trackById(s.song, s.sel.tid), s.sel.cid));
  return (
    <section className="panel" id="editorPanel">
      <div className="panel-head">
        <h2>Piano roll</h2>
        <span className="label" id="edWhere">
          {tr ? (c ? `${tr.name} · bars ${c.start + 1}–${c.start + c.len}` : tr.name) : ""}
        </span>
      </div>
      <div className="editor-body" id="editor">
        {!tr ? (
          <div className="empty">
            <p>Add a track to start.</p>
          </div>
        ) : (
          <>
            <TrackSettings tr={tr} />
            {c ? (
              <>
                <ClipRow tr={tr} c={c} />
                <PianoRoll key={c.id + c.loop} tr={tr} c={c} />
              </>
            ) : (
              <div className="empty">
                <p>
                  {tr.clips.length
                    ? `Click a clip in the ${tr.name} lane to edit its notes, or draw a new one by dragging across empty bars.`
                    : `The ${tr.name} lane is empty. Drag across bars in it to draw a clip, or add one here.`}
                </p>
                <button className="btn" onClick={() => addClipAt(tr.id, Math.floor(playPos() / SPB))}>
                  Add a 1-bar clip at the playhead
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <p className="hint">
        Click to add a note, drag it to move, drag its right edge to change length, click it again to delete.{" "}
        <kbd>Shift</kbd>+click makes a note softer. <kbd>Space</kbd> play, <kbd>⌘/Ctrl+D</kbd> duplicate clip,{" "}
        <kbd>Delete</kbd> remove clip.
      </p>
    </section>
  );
}

export function SoundSelect(props: {
  value: string | null;
  onChange: (id: string) => void;
  label: string;
  bassFirst?: boolean;
}) {
  const song = useStudio((s) => s.song);
  const melodicFirst = (k: string) => (MELODIC.has(k as never) ? 0 : 1);
  const order = props.bassFirst ? [...CATS].sort((a, b) => melodicFirst(a[0]) - melodicFirst(b[0])) : CATS;
  const own = song.sounds ?? [];
  return (
    <select
      aria-label={props.label}
      value={props.value ?? ""}
      onChange={(e) => e.target.value && props.onChange(e.target.value)}
    >
      {!props.value && <option value="">(empty)</option>}
      {own.length > 0 && (
        <optgroup label="My sounds">
          {own.map((k) => (
            <option key={k.id} value={k.id}>
              {sampleLabel(k)}
            </option>
          ))}
        </optgroup>
      )}
      {order.map(([kind, title]) => (
        <optgroup key={kind} label={title}>
          {KIT.filter((k) => k.kind === kind).map((k) => (
            <option key={k.id} value={k.id}>
              {sampleLabel(k)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  fmt: (v: number) => string;
  onInput: (v: number) => void;
}) {
  return (
    <label className="ctl">
      <span className="label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-label={props.label}
        onChange={(e) => props.onInput(+e.target.value)}
      />
      <output>{props.fmt(props.value)}</output>
    </label>
  );
}

function TrackSettings({ tr }: { tr: Track }) {
  return (
    <div className="ed-row" style={{ ["--c" as string]: `var(--t${tr.color})` }}>
      <div className="ed-title">
        <span className="swatch"></span>
        <strong>{tr.name}</strong>
      </div>
      {tr.type === "synth" && (
        <>
          <label className="ctl">
            <span className="label">Sound</span>
            <SoundSelect
              value={tr.sample}
              label={tr.name + " sound"}
              bassFirst
              onChange={(v) => setSynthSound(tr.id, v)}
            />
          </label>
          <label className="ctl" title="One note at a time, like a classic bass synth">
            <input
              type="checkbox"
              checked={tr.mono}
              onChange={(e) => setTrackProp(tr.id, "mono", e.target.checked, "Mono")}
            />
            Mono
          </label>
          <label className="ctl" title="Dip this track's volume on every kick (sidechain)">
            <input
              type="checkbox"
              checked={tr.duck}
              onChange={(e) => setTrackProp(tr.id, "duck", e.target.checked, "Duck to kick")}
            />
            Duck to kick
          </label>
        </>
      )}
      <Slider
        label="Filter"
        min={0}
        max={100}
        step={1}
        value={cutToPos(tr.cutoff || FMAX)}
        fmt={(p) => {
          const f = posToCut(p);
          return f >= 1000 ? (f / 1000).toFixed(1) + "k" : f + "";
        }}
        onInput={(v) => setTrackProp(tr.id, "cutoff", posToCut(v), "Filter", "cutoff:")}
      />
      <Slider
        label="Reverb"
        min={0}
        max={1}
        step={0.01}
        value={tr.send || 0}
        fmt={(v) => Math.round(v * 100) + "%"}
        onInput={(v) => setTrackProp(tr.id, "send", v, "Reverb", "send:")}
      />
      <Slider
        label="Pan"
        min={-1}
        max={1}
        step={0.05}
        value={tr.pan || 0}
        fmt={(v) => (v === 0 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100))}
        onInput={(v) => setTrackProp(tr.id, "pan", v, "Pan", "pan:")}
      />
    </div>
  );
}

const LEN_OPTS: [number, string][] = [
  [1, "1/16"],
  [2, "1/8"],
  [4, "1/4"],
  [8, "1/2"],
  [16, "1 bar"],
];

function ClipRow({ tr, c }: { tr: Track; c: Clip }) {
  const noteLen = useStudio((s) => s.ui.noteLen);
  const cw = useStudio((s) => s.ui.cw);
  const grooves = tr.type === "drums" ? DRUM_GROOVES : BASS_GROOVES;
  const transpose = (dd: number) => () => {
    if (!c.notes.length) return;
    clipEdit(tr.id, c.id, "Transpose", (cl) => cl.notes.forEach((n) => (n.p = clamp(n.p + dd, LOW, HIGH))));
  };
  return (
    <div className="ed-row" style={{ ["--c" as string]: `var(--t${tr.color})` }}>
      <div className="ed-title">
        <span className="label">Clip</span>
        <input
          key={c.name}
          defaultValue={c.name}
          placeholder={tr.name}
          aria-label="Clip name"
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v !== c.name) clipEdit(tr.id, c.id, "Rename clip", (cl) => (cl.name = v));
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </div>
      <label className="ctl" title="Length of the pattern. A longer clip repeats it.">
        <span className="label">Pattern</span>
        <select
          value={c.loop}
          onChange={(e) => clipEdit(tr.id, c.id, "Pattern length", (cl) => (cl.loop = +e.target.value))}
        >
          {[1, 2, 3, 4, 6, 8, 12, 16].map((n) => (
            <option key={n} value={n}>
              {n + (n === 1 ? " bar" : " bars")}
            </option>
          ))}
        </select>
      </label>
      <label className="ctl">
        <span className="label">New notes</span>
        <select value={noteLen} onChange={(e) => setUi({ noteLen: +e.target.value })}>
          {LEN_OPTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <Slider label="Zoom" min={12} max={36} step={1} value={cw} fmt={() => ""} onInput={(v) => setUi({ cw: v })} />
      <label
        className="ctl"
        title={
          tr.type === "drums"
            ? "Replace this clip with a preset drum groove"
            : "Replace this clip with a preset groove in the song key"
        }
      >
        <span className="label">Groove</span>
        <select
          aria-label="Apply a groove preset"
          value=""
          onChange={(e) => {
            const g = grooves[+e.target.value];
            if (e.target.value !== "" && g) applyGrooveTo(tr.id, c.id, g);
          }}
        >
          <option value="">Choose…</option>
          {grooves.map((g, i) => (
            <option key={g.name} value={i}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="btn"
        title="Show 3 alternatives you can try and keep"
        onClick={() => {
          showLocalVariations(tr.id, c.id);
          document.getElementById("assistant")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }}
      >
        3 variations
      </button>
      {tr.type === "synth" && (
        <span className="group">
          <span className="label">Transpose</span>
          <button className="mini" onClick={transpose(-12)}>
            −12
          </button>
          <button className="mini" onClick={transpose(-1)}>
            −1
          </button>
          <button className="mini" onClick={transpose(1)}>
            +1
          </button>
          <button className="mini" onClick={transpose(12)}>
            +12
          </button>
        </span>
      )}
      <span className="group">
        <button className="btn" onClick={() => duplicateClip(tr.id, c.id)}>
          Duplicate
        </button>
        <button
          className="btn"
          onClick={() => c.notes.length && clipEdit(tr.id, c.id, "Clear notes", (cl) => (cl.notes = []))}
        >
          Clear notes
        </button>
        <ArmButton className="btn" armedLabel="Confirm delete" onConfirm={() => deleteClip(tr.id, c.id)}>
          Delete clip
        </ArmButton>
      </span>
    </div>
  );
}

// ---------- piano roll ----------
const noteAt = (notes: Note[], step: number, val: number) =>
  notes.findIndex((n) => n.p === val && n.t <= step && step < n.t + n.d);
const clipIn = (d: Song, tid: string, cid: string) =>
  d.tracks.find((t) => t.id === tid)?.clips.find((x) => x.id === cid);

function PianoRoll({ tr, c }: { tr: Track; c: Clip }) {
  const cw = useStudio((s) => s.ui.cw);
  const row = useStudio((s) => s.sel.row);
  const drums = tr.type === "drums",
    rows = drums ? 8 : HIGH - LOW + 1,
    rh = drums ? 30 : 15,
    L = c.loop * SPB;
  const ph = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  usePlayhead(
    (pos) => {
      const el = ph.current;
      if (!el) return;
      const s0 = c.start * SPB,
        s1 = (c.start + c.len) * SPB;
      el.hidden = !(pos >= s0 && pos < s1);
      if (!el.hidden) el.style.transform = `translateX(${((pos - s0) % L) * cw}px)`;
    },
    [c.start, c.len, L, cw],
  );

  const setWrap = (el: HTMLDivElement | null) => {
    if (el && !drums && !scrolled.current) {
      scrolled.current = true;
      const ps = c.notes.map((n) => n.p),
        mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 41;
      requestAnimationFrame(() => (el.scrollTop = Math.max(0, (HIGH - mid) * rh - el.clientHeight / 2 + 24)));
    }
  };

  const onDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const grid = e.currentTarget,
      r = grid.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top,
      step = clamp(Math.floor(x / cw), 0, L - 1),
      rr = Math.floor(y / rh);
    const val = drums ? clamp(rr, 0, 7) : clamp(HIGH - rr, LOW, HIGH);
    const tid = tr.id,
      cid = c.id;
    const play = (p: number) => {
      const t = trackById(get().song, tid);
      if (t && drums) auditionPad(t, p);
      else if (t) auditionNote(t, p);
    };
    const idx = noteAt(c.notes, step, val);
    type Drag = { mode: "move" | "resize" | "draw"; t: number; d: number; p: number; moved: boolean };
    let drag: Drag;
    beginGesture();
    if (idx >= 0) {
      const hit = c.notes[idx]!;
      if (e.shiftKey) {
        updateGesture((d) => {
          const n = clipIn(d, tid, cid)!.notes[idx]!;
          n.v = n.v >= 0.8 ? 0.55 : 1;
        });
        endGesture("Note velocity");
        return;
      }
      drag = { mode: x > (hit.t + hit.d) * cw - 7 ? "resize" : "move", t: hit.t, d: hit.d, p: hit.p, moved: false };
    } else {
      if (drums && row !== val) select({ row: val });
      drag = {
        mode: "draw",
        t: step,
        d: Math.max(1, Math.min(drums ? 1 : get().ui.noteLen, L - step)),
        p: val,
        moved: false,
      };
      const n0 = N(drag.t, drag.d, drag.p);
      updateGesture((d) => void clipIn(d, tid, cid)!.notes.push({ ...n0 }));
      play(val);
    }
    const x0 = x,
      y0 = y,
      start = { ...drag };
    grid.setPointerCapture(e.pointerId);
    const apply = () =>
      updateGesture((d) => {
        const notes = clipIn(d, tid, cid)!.notes;
        if (drag.mode === "draw") notes.push(N(drag.t, drag.d, drag.p));
        else Object.assign(notes[idx]!, { t: drag.t, d: drag.d, p: drag.p });
      });
    const move = (ev: PointerEvent) => {
      const mx = ev.clientX - r.left,
        my = ev.clientY - r.top,
        before = `${drag.t}:${drag.d}:${drag.p}`;
      if (drag.mode === "move") {
        drag.t = clamp(start.t + Math.round((mx - x0) / cw), 0, L - 1);
        const dr = Math.round((my - y0) / rh);
        const np = drums ? clamp(start.p + dr, 0, 7) : clamp(start.p - dr, LOW, HIGH);
        if (np !== drag.p) play(np);
        drag.p = np;
        drag.d = Math.min(start.d, L - drag.t);
      } else if (drag.mode === "resize") {
        drag.d = clamp(start.d + Math.round((mx - x0) / cw), 1, L - drag.t);
      } else {
        const s = Math.floor(mx / cw);
        if (s > start.t) drag.d = clamp(s - start.t + 1, 1, L - drag.t);
      }
      if (before !== `${drag.t}:${drag.d}:${drag.p}`) {
        drag.moved = true;
        apply();
      }
    };
    const up = () => {
      grid.removeEventListener("pointermove", move);
      grid.removeEventListener("pointerup", up);
      grid.removeEventListener("pointercancel", up);
      if (drag.mode === "draw") endGesture("Add note");
      else if (drag.moved) endGesture(drag.mode === "move" ? "Move note" : "Resize note");
      else {
        updateGesture((d) => void clipIn(d, tid, cid)!.notes.splice(idx, 1));
        endGesture("Delete note");
      }
    };
    grid.addEventListener("pointermove", move);
    grid.addEventListener("pointerup", up);
    grid.addEventListener("pointercancel", up);
  };

  const ruler = [];
  for (let b = 0; b < c.loop; b++)
    for (let q = 0; q < 4; q++)
      ruler.push(
        <span key={b * 4 + q} className={"beat" + (q === 0 ? " bar" : "")} style={{ left: (b * 16 + q * 4) * cw }}>
          {q === 0 ? String(b + 1) : "." + (q + 1)}
        </span>,
      );

  return (
    <div className="roll-scroll" id="rollScroll" ref={setWrap}>
      <div
        className="roll"
        style={{
          ["--cw" as string]: cw + "px",
          ["--rh" as string]: rh + "px",
          ["--cols" as string]: L,
          ["--rows" as string]: rows,
          ["--keys-w" as string]: (drums ? 178 : 52) + "px",
          ["--c" as string]: `var(--t${tr.color})`,
        }}
      >
        <div className="roll-corner"></div>
        <div className="roll-ruler">{ruler}</div>
        <div className="keys">
          {Array.from({ length: rows }, (_, r) =>
            drums ? (
              <div
                key={r}
                className={"pad-row" + (row === r ? " sel" : "")}
                data-row={r}
                onPointerDown={(e) => {
                  if ((e.target as Element).tagName === "SELECT") return;
                  select({ row: r });
                  auditionPad(tr, r);
                }}
              >
                <span className="pad-n">{r + 1}</span>
                <SoundSelect
                  value={tr.type === "drums" ? (tr.pads[r] ?? null) : null}
                  label={"Pad " + (r + 1) + " sound"}
                  onChange={(v) => setPadSound(tr.id, r, v)}
                />
              </div>
            ) : (
              <div
                key={r}
                className={"key" + (BLACK.has((HIGH - r) % 12) ? " black" : "") + ((HIGH - r) % 12 === 0 ? " c" : "")}
                onPointerDown={() => auditionNote(tr, HIGH - r)}
              >
                {pname(HIGH - r)}
              </div>
            ),
          )}
        </div>
        <div className="roll-grid" id="rollGrid" onPointerDown={onDown}>
          {Array.from({ length: rows }, (_, r) => (
            <div
              key={r}
              data-row={r}
              style={{ top: r * rh }}
              className={
                "row" +
                (!drums && BLACK.has((HIGH - r) % 12) ? " black" : "") +
                (drums && r % 2 ? " alt" : "") +
                (drums && r === row ? " selrow" : "")
              }
            ></div>
          ))}
          <div className="lines"></div>
          <div className="notes" id="rollNotes">
            {c.notes.map((n, i) =>
              n.t >= L ? null : (
                <div
                  key={i}
                  className={"note" + (n.v < 0.8 ? " soft" : "")}
                  title={
                    drums
                      ? (soundOf(useStudio.getState().song, tr.type === "drums" ? tr.pads[n.p] : null)?.name ?? "")
                      : pname(n.p)
                  }
                  style={{
                    left: n.t * cw,
                    top: (drums ? n.p : HIGH - n.p) * rh,
                    width: Math.max(4, Math.min(n.d, L - n.t) * cw - 1),
                  }}
                ></div>
              ),
            )}
          </div>
          <div className="roll-ph" id="rollPh" ref={ph} hidden></div>
        </div>
      </div>
    </div>
  );
}
