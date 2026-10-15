// Personal-account smoke test; never run in CI. It edits a copy, not the open studio.
// node --experimental-strip-types apps/api/test/live-chatgpt.ts
import { demoSong } from "@thk/song";
import { runOnChatGPT } from "../src/chatgpt.ts";

const out = await runOnChatGPT({
  song: demoSong(),
  request:
    "Add a four-to-the-floor kick on a new drum track called Groove for bars 1-4. Use write_drums. Reply in one sentence.",
  tier: "quick",
});
console.log(
  JSON.stringify(
    {
      provider: out.provider,
      model: out.model,
      text: out.text,
      steps: out.steps,
      edits: out.edits.length,
      stop: out.stop,
    },
    null,
    2,
  ),
);
if (!out.edits.some((e) => e.tool === "write_drums") || out.stop !== "done") process.exitCode = 1;
