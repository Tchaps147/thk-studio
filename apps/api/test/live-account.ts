// Manual check against the real Claude account: node --experimental-strip-types apps/api/test/live-account.ts
import { demoSong } from "@thk/song";
import { runOnAccount } from "../src/account.ts";
const t0 = Date.now();
const out = await runOnAccount({
  song: demoSong(),
  request: "Add a four-to-the-floor kick on a new drum track called Groove for bars 1-4.",
  tier: "quick",
});
console.log(
  JSON.stringify(
    {
      ms: Date.now() - t0,
      text: out.text,
      steps: out.steps,
      edits: out.edits.length,
      stop: out.stop,
      usage: out.usage,
    },
    null,
    1,
  ),
);
