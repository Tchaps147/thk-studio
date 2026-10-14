import { useEffect, useState } from "react";
import { clipById, songEnd, trackById } from "@thk/song";
import { Arrangement } from "./components/Arrangement.tsx";
import { Assistant } from "./components/Assistant.tsx";
import { Browser } from "./components/Browser.tsx";
import { Dialog, Toast, type DialogKind } from "./components/Dialogs.tsx";
import { Editor } from "./components/Editor.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { deleteClip, duplicateClip, toggleLoop } from "./lib/actions.ts";
import { seek, togglePlay } from "./lib/audio.ts";
import { get, redo, toast, undo } from "./lib/store.ts";

export function App() {
  const [dialog, setDialog] = useState<DialogKind>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing =
        (t.tagName === "INPUT" && !["range", "checkbox"].includes((t as HTMLInputElement).type)) ||
        t.tagName === "SELECT" ||
        t.tagName === "TEXTAREA";
      if (typing || dialog) return;
      const mod = e.metaKey || e.ctrlKey,
        k = e.key.toLowerCase();
      const { sel, song } = get(),
        c = clipById(trackById(song, sel.tid), sel.cid);
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod && k === "d") {
        e.preventDefault();
        if (c && sel.tid) duplicateClip(sel.tid, c.id);
      } else if ((e.key === "Delete" || e.key === "Backspace") && c && sel.tid) {
        e.preventDefault();
        deleteClip(sel.tid, c.id);
      } else if (k === "l" && !mod) toggleLoop();
      else if (e.key === "Home") seek(0);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog]);

  return (
    <>
      <TopBar
        onNew={() => setDialog("new")}
        onExport={() => (songEnd(get().song) ? setDialog("export") : toast("Add a clip before exporting."))}
      />
      <div className="app">
        <Browser />
        <main className="work">
          <Arrangement />
          <Editor />
        </main>
        <Assistant />
      </div>
      <Dialog kind={dialog} onClose={() => setDialog(null)} />
      <Toast />
    </>
  );
}
