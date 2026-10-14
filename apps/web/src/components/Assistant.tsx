import { useEffect, useRef, useState } from "react";
import { findTrack } from "@thk/song";
import { keepVariation, revertVariation, tryVariation } from "../lib/actions.ts";
import { sendPrompt, stopPrompt, undoTurn } from "../lib/assistant.ts";
import { get, useStudio, type ChatMsg } from "../lib/store.ts";

const CHIPS = [
  "Four-to-the-floor kick on bars 1–16, then add hats that work with it",
  "Show me 3 drum variations that work with the bass",
  "Show me 3 bass variations that work with the drums",
  "Make the tops more percussive in bars 9–24",
  "Write a 4-bar breakdown with a snare build before the last drop",
];

export function Assistant() {
  const chat = useStudio((s) => s.chat);
  const { available, busy } = useStudio((s) => s.ai);
  const [tier, setTier] = useState("quick");
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);
  const send = (v: string) => {
    if (!v.trim() || !available || busy) return;
    setText("");
    void sendPrompt(v, tier);
  };
  return (
    <aside className="panel assistant" id="assistant">
      <div className="panel-head">
        <h2>Assistant</h2>
        <label className="ctl" title="Fast answers in seconds. Thorough thinks longer and writes more musical parts.">
          <span className="label">Mode</span>
          <select id="aiTier" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="quick">Fast</option>
            <option value="default">Thorough</option>
          </select>
        </label>
      </div>
      <div className="chat" id="chat" aria-live="polite" ref={box}>
        {chat.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </div>
      <div className="chips" id="chips">
        {CHIPS.map((c) => (
          <button key={c} className="chip" type="button" disabled={!available || busy} onClick={() => send(c)}>
            {c}
          </button>
        ))}
      </div>
      <form
        className="composer"
        id="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          id="prompt"
          rows={2}
          value={text}
          disabled={!available || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(e.currentTarget.value);
            }
          }}
          placeholder="e.g. Put a four-to-the-floor kick on bars 1–16, then add hats that work with it"
        ></textarea>
        <div className="cbtns">
          <button className="btn primary" id="sendBtn" type="submit" hidden={busy} disabled={!available}>
            Send
          </button>
          <button className="btn" id="stopBtn" type="button" hidden={!busy} onClick={stopPrompt}>
            Stop
          </button>
        </div>
      </form>
    </aside>
  );
}

function Message({ m }: { m: ChatMsg }) {
  if (m.kind === "user") return <div className="msg user">{m.text}</div>;
  return (
    <div className={"msg bot" + (m.thinking ? " thinking" : "")}>
      <span className="label who">{m.who ?? "Assistant"}</span>
      <div className="body">{m.text}</div>
      <div className="acts">
        {m.actions.map((a, i) => (
          <div key={i} className={a.err ? "err" : ""}>
            {(a.err ? "✕ " : "✓ ") + a.text}
          </div>
        ))}
      </div>
      {m.groupIds?.map((g) => (
        <Group key={g} gid={g} />
      ))}
      {m.undo && (
        <div className="row-btns">
          <button className="btn" disabled={m.undo.done} onClick={() => undoTurn(m.id)}>
            {m.undo.done ? "Changes undone" : "Undo these changes"}
          </button>
        </div>
      )}
    </div>
  );
}

function Group({ gid }: { gid: string }) {
  const g = useStudio((s) => s.groups[gid]);
  const live = useStudio((s) => s.pending?.groupId === gid);
  if (!g) return null;
  const trackLabel = (ref: unknown) => findTrack(get().song, ref)?.name ?? String(ref);
  return (
    <div className="vgroup">
      <span className="label">{g.title}</span>
      {g.specs.map((sp, i) => {
        const on = live && g.tried === i;
        return (
          <div key={i} className={"var" + (on ? " tried" : "") + (g.kept === i ? " kept" : "")}>
            <div className="var-top">
              <strong>{`${i + 1}. ${sp.name}`}</strong>
              <span className="group">
                <button className="mini" onClick={() => tryVariation(gid, i)}>
                  {on ? "Restart" : "Try"}
                </button>
                {on && (
                  <button className="mini" onClick={() => keepVariation(gid)}>
                    Keep
                  </button>
                )}
              </span>
            </div>
            {sp.why && <div className="why">{sp.why}</div>}
            <div className="where">
              {`${trackLabel(sp.track)} · bars ${sp.start + 1}–${sp.start + sp.len}${g.kept === i ? " · kept" : ""}`}
            </div>
          </div>
        );
      })}
      {live && (
        <div className="row-btns">
          <button className="btn" onClick={() => revertVariation(gid)}>
            Back to original
          </button>
        </div>
      )}
    </div>
  );
}
