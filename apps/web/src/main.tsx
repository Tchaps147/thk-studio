import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { boot, scheduleSave } from "./lib/actions.ts";
import { audio, startAudio, wake } from "./lib/audio.ts";
import { buildExport } from "./lib/export.ts";
import * as song from "@thk/song";
import { initAssistant } from "./lib/assistant.ts";
import { startPlayheadLoop } from "./lib/playhead.ts";
import { addMsg, useStudio } from "./lib/store.ts";
import * as studio from "./lib/store.ts";
import "./styles.css";

boot();
startAudio();
startPlayheadLoop();
useStudio.subscribe((s, prev) => {
  if (s.song !== prev.song) scheduleSave(s.song);
});
document.addEventListener("pointerdown", wake, { capture: true });
addMsg({
  kind: "bot",
  who: "Assistant",
  text: "Tell me what to write or change, like “four-to-the-floor kick on bars 1–16 with hats that work with it” or “show me 3 bass variations for the drums”. I edit the song directly, and every change can be undone.",
});
void initAssistant();

// Test and debugging hook (read-only use in e2e tests).
(window as unknown as { __thk: unknown }).__thk = { ...studio, audio, buildExport, song };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
