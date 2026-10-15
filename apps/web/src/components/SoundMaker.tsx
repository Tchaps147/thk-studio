import { useEffect, useRef, useState } from "react";
import { peaksOf } from "@thk/audio";
import {
  CAT,
  INSTRUMENTS,
  KIT,
  MELODIC,
  PARAMS,
  clampPatch,
  isBool,
  isEnum,
  pname,
  sampleLabel,
  soundOf,
  trackById,
  type Param,
  type Patch,
  type SoundKind,
} from "@thk/song";
import { closeMaker, openMaker, saveDraft, updateDraft } from "../lib/actions.ts";
import { audio, auditionDraft } from "../lib/audio.ts";
import { sendPrompt } from "../lib/assistant.ts";
import { cssVar, fitCanvas, useRedrawKey } from "../lib/playhead.ts";
import { get, useStudio } from "../lib/store.ts";

const GROUPS = ["Sample", "Source", "Pitch", "Filter", "Amp", "Character"] as const;
const KEYS = Array.from({ length: 25 }, (_, i) => 36 + i); // C2..C4

/** Slider position 0..1000 <-> value, logarithmic for frequencies and times. */
const toPos = (p: Param & { min: number; max: number; log?: boolean }, v: number) =>
  p.log
    ? (1000 * Math.log((Math.max(v, p.min) + 0.001) / (p.min + 0.001))) / Math.log((p.max + 0.001) / (p.min + 0.001))
    : (1000 * (v - p.min)) / (p.max - p.min);
const fromPos = (p: Param & { min: number; max: number; log?: boolean; step: number }, pos: number) => {
  const raw = p.log
    ? (p.min + 0.001) * Math.pow((p.max + 0.001) / (p.min + 0.001), pos / 1000) - 0.001
    : p.min + ((p.max - p.min) * pos) / 1000;
  return Math.round(raw / p.step) * p.step;
};
const fmt = (v: number, unit?: string) => {
  if (unit === "Hz") return v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "";
  if (unit === "s") return v < 1 ? Math.round(v * 1000) + "ms" : v.toFixed(2) + "s";
  return (Math.abs(v) < 10 ? +v.toFixed(2) : Math.round(v)) + (unit ? " " + unit : "");
};

export function SoundMaker() {
  const maker = useStudio((s) => s.maker);
  const song = useStudio((s) => s.song);
  const sel = useStudio((s) => s.sel);
  const busy = useStudio((s) => s.ai.busy);
  const aiOn = useStudio((s) => s.ai.available);
  const [ask, setAsk] = useState("");
  const [lastNote, setLastNote] = useState(36);
  const cv = useRef<HTMLCanvasElement>(null);
  const redraw = useRedrawKey();
  const draft = maker?.draft;

  // Render the draft whenever it changes; draw its waveform; play it after a knob settles.
  const [rendered, setRendered] = useState(0);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    const t = setTimeout(() => {
      void audio()
        .bank.loadSound(draft, get().song)
        .then((b) => {
          if (!live || !b) return;
          const c = cv.current && fitCanvas(cv.current);
          if (c) {
            c.g.fillStyle = cssVar(cv.current!, "--c") || cssVar(document.body, "--led");
            const pk = peaksOf(b, 120),
              bw = c.w / pk.length;
            pk.forEach((m, i) => {
              const bh = Math.max(1, m * c.h);
              c.g.fillRect(i * bw, (c.h - bh) / 2, Math.max(1, bw - 0.5), bh);
            });
          }
          setRendered((n) => n + 1);
        });
    }, 60);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [draft, redraw]);

  if (!maker || !draft || !draft.patch) return null;
  const patch = draft.patch;
  const melodic = MELODIC.has(draft.kind);
  const tr = trackById(song, sel.tid);
  const target = tr ? (tr.type === "synth" ? tr.name : `${tr.name} pad ${sel.row + 1}`) : null;
  const set = (p: Partial<Patch>, play = true) => {
    updateDraft({ patch: clampPatch(p, patch) });
    if (play) setTimeout(() => void auditionDraft(get().maker!.draft, melodic ? lastNote : 36), 90);
  };
  const starts = KIT.filter((s) => s.kind === draft.kind).concat(
    (song.sounds ?? []).filter((s) => s.kind === draft.kind),
  );

  const describe = async () => {
    const text = ask.trim();
    if (!text) return;
    setAsk("");
    const before = new Set((get().song.sounds ?? []).map((s) => s.id));
    const ask2 = maker.isNew
      ? `Make a new ${CAT[draft.kind].one.toLowerCase()} sound with design_sound${target ? ` and put it on ${target}` : ""}: ${text}`
      : `Edit the sound ${draft.id} ("${draft.name}") with edit_sound: ${text}`;
    await sendPrompt(ask2, "quick");
    const s = get().song,
      made = (s.sounds ?? []).find((x) => !before.has(x.id)),
      edited = !maker.isNew ? soundOf(s, draft.id) : undefined;
    const open = made ?? edited;
    if (open) openMaker(open.kind, open);
  };

  return (
    <section
      className="panel maker"
      id="soundMaker"
      data-testid="sound-maker"
      style={{ ["--c" as string]: "var(--t3)" }}
    >
      <div className="panel-head">
        <h2>Sound maker</h2>
        <span className="label">{maker.isNew ? "New sound" : "Editing your sound"}</span>
      </div>
      <div className="ed-row">
        <label className="ctl">
          <span className="label">Name</span>
          <input
            className="maker-name"
            aria-label="Sound name"
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value.slice(0, 40) })}
          />
        </label>
        <label className="ctl">
          <span className="label">Instrument</span>
          <select
            aria-label="Instrument"
            value={draft.kind}
            disabled={!maker.isNew}
            onChange={(e) => openMaker(e.target.value as SoundKind)}
          >
            {INSTRUMENTS.map((i) => (
              <option key={i.kind} value={i.kind}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ctl" title="Start again from a preset, or reshape a kit sample">
          <span className="label">Start from</span>
          <select
            aria-label="Start from"
            value=""
            onChange={(e) => {
              const s = soundOf(song, e.target.value);
              if (s) {
                openMaker(s.kind, s);
                if (maker.isNew) updateDraft({ name: draft.name });
              }
            }}
          >
            <option value="">Choose…</option>
            {starts.map((s) => (
              <option key={s.id} value={s.id}>
                {sampleLabel(s)}
                {s.patch ? "" : " (sample)"}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer"></span>
        <button className="btn" onClick={() => void auditionDraft(draft, melodic ? lastNote : 36)}>
          ▶ Play
        </button>
      </div>

      <div className="maker-view">
        <canvas ref={cv} className="maker-wave" aria-label="Waveform" data-rendered={rendered}></canvas>
        {melodic ? (
          <div className="maker-keys" role="group" aria-label="Play notes">
            {KEYS.map((p) => (
              <button
                key={p}
                className={"mkey" + ([1, 3, 6, 8, 10].includes(p % 12) ? " black" : "") + (p === lastNote ? " on" : "")}
                title={pname(p)}
                onPointerDown={() => {
                  setLastNote(p);
                  void auditionDraft(draft, p);
                }}
              >
                {p % 12 === 0 ? pname(p) : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="maker-groups">
        {GROUPS.map((g) => {
          const params = PARAMS.filter((p) => p.group === g && p.engines.includes(patch.engine) && p.key !== "source");
          if (!params.length && !(g === "Sample" && patch.engine === "sample")) return null;
          return (
            <fieldset key={g} className="maker-group">
              <legend className="label">{g}</legend>
              {g === "Sample" && patch.engine === "sample" && (
                <div className="mrow">
                  <span>Source</span>
                  <span className="mval">{soundOf(song, patch.source)?.name ?? "?"}</span>
                </div>
              )}
              {params.map((p) => (
                <ParamControl
                  key={p.key}
                  p={p}
                  value={patch[p.key]}
                  onChange={(v, play) => set({ [p.key]: v }, play)}
                />
              ))}
            </fieldset>
          );
        })}
      </div>

      <form
        className="ed-row maker-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void describe();
        }}
      >
        <input
          aria-label="Describe the sound"
          placeholder={
            maker.isNew
              ? "Describe it and let the assistant build it, e.g. dark rubbery acid bass with a fast squelch"
              : "Describe a change, e.g. brighter and punchier, less sub"
          }
          value={ask}
          disabled={!aiOn || busy}
          onChange={(e) => setAsk(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!aiOn || busy || !ask.trim()}>
          {busy ? "Working…" : maker.isNew ? "Make it" : "Change it"}
        </button>
      </form>

      <div className="ed-row">
        <button className="btn primary" onClick={() => saveDraft(false)}>
          {maker.isNew ? "Save sound" : "Save changes"}
        </button>
        <button
          className="btn"
          disabled={!target}
          onClick={() => saveDraft(true)}
          title="Save, then put it on the selected track or pad"
        >
          {target ? `Save and use on ${target}` : "Select a track to use it"}
        </button>
        <button className="btn" onClick={closeMaker}>
          Close
        </button>
        <span className="hint">
          {melodic
            ? "Melodic sounds are rooted on C2, so they play in tune on synth tracks."
            : "One-shot sound for a drum pad."}
        </span>
      </div>
    </section>
  );
}

function ParamControl({
  p,
  value,
  onChange,
}: {
  p: Param;
  value: unknown;
  onChange: (v: unknown, play: boolean) => void;
}) {
  if (isEnum(p))
    return (
      <label className="mrow">
        <span>{p.label}</span>
        <select aria-label={p.label} value={String(value)} onChange={(e) => onChange(e.target.value, true)}>
          {p.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  if (isBool(p))
    return (
      <label className="mrow" title={p.help}>
        <span>{p.label}</span>
        <input
          type="checkbox"
          aria-label={p.label}
          checked={!!value}
          onChange={(e) => onChange(e.target.checked, true)}
        />
      </label>
    );
  const v = value as number;
  return (
    <label className="mrow" title={p.help}>
      <span>{p.label}</span>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        aria-label={p.label}
        value={Math.round(toPos(p, v))}
        onChange={(e) => onChange(fromPos(p, +e.target.value), false)}
        onPointerUp={(e) => onChange(fromPos(p, +(e.target as HTMLInputElement).value), true)}
        onKeyUp={(e) => onChange(fromPos(p, +(e.target as HTMLInputElement).value), true)}
      />
      <output className="mval">{fmt(v, p.unit)}</output>
    </label>
  );
}
