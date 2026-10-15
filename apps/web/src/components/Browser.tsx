import { useEffect, useRef, useState } from "react";
import { peaksOf } from "@thk/audio";
import {
  CAT,
  CHORD_FAMILIES,
  CHORD_LABELS,
  KIT,
  SOUND_GROUPS,
  chordFamilyLabel,
  sampleNum,
  soundOf,
  trackById,
  type ChordFamily,
  type Sound,
  type SoundKind,
} from "@thk/song";
import { assign, openMaker } from "../lib/actions.ts";
import { audio, auditionSample } from "../lib/audio.ts";
import { cssVar, fitCanvas, useRedrawKey } from "../lib/playhead.ts";
import { setUi, useStudio } from "../lib/store.ts";

const KEY_PREVIEWS: Partial<Record<SoundKind, number>> = {
  piano: 48,
  electric_piano: 48,
  organ: 48,
  strings: 48,
  brass: 48,
  guitar: 48,
  mallet: 60,
  atmosphere: 48,
};

export function Browser() {
  const tab = useStudio((s) => s.ui.tab);
  const song = useStudio((s) => s.song);
  const library = useStudio((s) => s.library);
  const [chordFamily, setChordFamily] = useState<ChordFamily | "all">("all");
  const [chordPreview, setChordPreview] = useState(48);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [pack, setPack] = useState("all");
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (s: Sound) => {
    if (!words.length && (s.kind !== tab || (tab === "chord" && chordFamily !== "all" && s.family !== chordFamily)))
      return false;
    const recorded = !!s.recording || !!s.sampleMap;
    if ((source === "recorded" && !recorded) || (source === "synth" && recorded)) return false;
    if (pack !== "all" && s.recording?.pack !== pack) return false;
    const text = [s.name, s.description, CAT[s.kind].plural, s.recording?.pack, ...(s.tags ?? [])]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const items = KIT.filter(matches).sort(
    (a, b) => Number(!!b.recording || !!b.sampleMap) - Number(!!a.recording || !!a.sampleMap),
  );
  const packs = [...new Set(KIT.map((s) => s.recording?.pack).filter((p): p is string => !!p))].sort();
  const group = SOUND_GROUPS.find((g) => g.categories.includes(tab)) ?? SOUND_GROUPS[0]!;
  const [remembered, setRemembered] = useState<Record<string, SoundKind>>({});
  const chooseGroup = (id: string) => {
    setQuery("");
    setPack("all");
    if (id === group.id) return;
    const next = SOUND_GROUPS.find((g) => g.id === id)!;
    setRemembered((r) => ({ ...r, [group.id]: tab }));
    setUi({ tab: remembered[id] ?? next.categories[0]! });
  };
  const mine = (song.sounds ?? []).filter(matches).concat(library.filter((s) => matches(s) && !soundOf(song, s.id)));
  return (
    <aside className="panel browser" data-testid="browser">
      <div className="panel-head">
        <h2>Sounds</h2>
        <span className="label" id="catCount">
          {items.length + mine.length} sounds
        </span>
        <button className="mini new-sound" title="Make a new sound in the sound maker" onClick={() => openMaker(tab)}>
          + New sound
        </button>
      </div>
      <div className="library-tools">
        <input
          type="search"
          aria-label="Search all sounds"
          placeholder={`Search all ${KIT.length} sounds…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="library-filters">
          <select
            aria-label="Sound source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPack("all");
            }}
          >
            <option value="all">All sounds</option>
            <option value="recorded">Recorded samples</option>
            <option value="synth">Synth sounds</option>
          </select>
          <select
            aria-label="Sample pack"
            value={pack}
            onChange={(e) => setPack(e.target.value)}
            disabled={source === "synth"}
          >
            <option value="all">All packs</option>
            {packs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="sound-groups" role="group" aria-label="Instrument group">
        {SOUND_GROUPS.map((g) => (
          <button key={g.id} aria-pressed={group.id === g.id} onClick={() => chooseGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      {group.categories.length > 1 && (
        <div className="cat-tabs" id="tabs" role="group" aria-label="Sound category">
          {group.categories.map((k) => (
            <button
              key={k}
              aria-pressed={k === tab}
              onClick={() => {
                setQuery("");
                setPack("all");
                setUi({ tab: k });
              }}
            >
              {k === "fx" ? "Sound effects" : CAT[k].plural}
            </button>
          ))}
        </div>
      )}
      <div className="browser-category">
        <strong>{words.length ? "Search results" : CAT[tab].plural}</strong>
        {!words.length && tab === "vocal" && (
          <span>Recorded vocal phrases, plus synthesized vowel chops & choir textures</span>
        )}
        {!words.length && tab === "chord" && <span>Play one note to trigger a full chord</span>}
        {!words.length && tab === "guitar" && (
          <span>Real recorded guitars first, followed by synth interpretations</span>
        )}
      </div>
      {tab === "chord" && !words.length && (
        <div className="chord-browser-tools">
          <div className="chord-families" role="group" aria-label="Chord style">
            <button aria-pressed={chordFamily === "all"} onClick={() => setChordFamily("all")}>
              All
            </button>
            {CHORD_FAMILIES.map((f) => (
              <button key={f.id} aria-pressed={chordFamily === f.id} onClick={() => setChordFamily(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="ctl chord-preview" title="Choose the octave used for sound previews.">
            <span className="label">Preview</span>
            <select
              aria-label="Chord preview octave"
              value={chordPreview}
              onChange={(e) => setChordPreview(+e.target.value)}
            >
              <option value={36}>C2 · Low</option>
              <option value={48}>C3 · Club</option>
              <option value={60}>C4 · Bright</option>
            </select>
          </label>
        </div>
      )}
      <Target />
      <div className="blist" id="blist">
        {!items.length && !mine.length && (
          <div className="browser-empty">
            <span className="empty-sound-icon" aria-hidden="true">
              ♫
            </span>
            <strong>No matching sounds</strong>
            <p>Try another name, instrument or sample pack.</p>
            <button
              className="btn"
              onClick={() => {
                setQuery("");
                setSource("all");
                setPack("all");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        {mine.length > 0 && <span className="label mine">My sounds</span>}
        {mine.map((s) => (
          <Item
            key={s.id}
            s={s}
            previewNote={s.previewNote ?? (s.kind === "chord" ? chordPreview : KEY_PREVIEWS[s.kind])}
          />
        ))}
        {mine.length > 0 && <span className="label mine">Built in</span>}
        {items.map((s) => (
          <Item
            key={s.id}
            s={s}
            previewNote={s.previewNote ?? (s.kind === "chord" ? chordPreview : KEY_PREVIEWS[s.kind])}
          />
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

function Item({ s, previewNote }: { s: Sound; previewNote?: number }) {
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
          auditionSample(s.id, previewNote);
          setHit(true);
          setTimeout(() => setHit(false), 140);
        }}
      >
        <span className="num">{s.custom ? "★" : s.recording ? "●" : sampleNum(s)}</span>
        <span className="item-name">{s.name}</span>
        <span className="item-meta">
          {(s.custom
            ? "mine · "
            : s.recording || s.sampleMap
              ? `recorded ${CAT[s.kind].one.toLowerCase()} · `
              : s.kind === "vocal"
                ? "synthetic vocal · "
                : s.patch
                  ? "synth · "
                  : "") +
            (s.kind === "kick" && s.note ? "key " + s.note + " · " : s.kind === "bass" && !s.patch ? "root C · " : "") +
            s.dur.toFixed(2) +
            " s"}
        </span>
        {s.recording && <span className="item-recording-pack">{s.recording.pack}</span>}
        {s.kind === "chord" && (
          <span className="item-chord-type">
            {s.patch?.chord ? CHORD_LABELS[s.patch.chord] : "Chord"}
            {s.family ? ` · ${chordFamilyLabel(s.family)}` : ""}
          </span>
        )}
        {s.description && <span className="item-description">{s.description}</span>}
        <canvas aria-hidden="true" ref={cv} data-id={s.id}></canvas>
      </button>
      <div className="acts2">
        <button className="use" title="Put this sound on the selected track or pad" onClick={() => assign(s.id)}>
          Use
        </button>
        <button
          className="use edit"
          title={
            s.custom
              ? "Edit this sound in the sound maker"
              : s.sampleMap
                ? "Shape an editable copy of one recorded C2 note"
                : "Make your own version of this sound"
          }
          onClick={() => openMaker(s.kind, s)}
        >
          {s.custom ? "Edit" : "Copy"}
        </button>
      </div>
    </div>
  );
}
