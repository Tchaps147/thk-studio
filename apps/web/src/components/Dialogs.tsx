import { useEffect, useRef, useState, type ReactNode } from "react";
import { songEnd } from "@thk/song";
import { newSong } from "../lib/actions.ts";
import { buildExport, download } from "../lib/export.ts";
import { get, toast, useStudio } from "../lib/store.ts";

export type DialogKind = "new" | "export" | null;

export function Dialog({ kind, onClose }: { kind: DialogKind; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (kind && !d.open) d.showModal();
    if (!kind && d.open) d.close();
  }, [kind]);
  return (
    <dialog id="dlg" ref={ref} onClose={onClose}>
      <div className="dlg-head">
        <h2 id="dlgTitle">{kind === "new" ? "New song" : kind === "export" ? "Export song" : ""}</h2>
        <button className="mini" id="dlgClose" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="dlg-body" id="dlgBody">
        {kind === "new" && <NewSong onClose={onClose} />}
        {kind === "export" && <ExportSong onClose={onClose} />}
      </div>
    </dialog>
  );
}

function NewSong({ onClose }: { onClose: () => void }) {
  const pick = (k: "empty" | "demo") => () => {
    newSong(k);
    onClose();
  };
  return (
    <>
      <p>Your current song stays one Undo away.</p>
      <div className="choice">
        <button className="btn" onClick={pick("empty")}>
          Empty song (drum + bass track)
        </button>
        <button className="btn" onClick={pick("demo")}>
          Demo song: Late Shift, 32 bars in F
        </button>
      </div>
    </>
  );
}

function ExportSong({ onClose }: { onClose: () => void }): ReactNode {
  const bars = useStudio((s) => songEnd(s.song));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const go = async () => {
    setBusy(true);
    setStatus("Rendering the song…");
    try {
      const { filename, zip } = await buildExport(get().song);
      download(filename, zip);
      setStatus("");
      onClose();
      toast("Exported " + filename);
    } catch (e) {
      setStatus("Couldn't export: " + ((e as Error)?.message || "unknown error") + ". Try again.");
    }
    setBusy(false);
  };
  return (
    <>
      <p>{`Renders all ${bars} bars to a WAV mixdown and writes a MIDI file of every track, packed in one zip.`}</p>
      <p className="status">
        Drag the MIDI into Ableton and load the matching WAVs from the kit to keep editing there.
      </p>
      <button className="btn primary" disabled={busy} onClick={() => void go()}>
        Export zip
      </button>
      <p className="status">{status}</p>
    </>
  );
}

export function Toast() {
  const t = useStudio((s) => s.toast);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!t) return;
    setShown(true);
    const id = setTimeout(() => setShown(false), 2600);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <div className="toast" id="toast" role="status" hidden={!shown}>
      {t?.text}
    </div>
  );
}
