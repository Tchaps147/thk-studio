// Records the prototype's offline-render event list for the demo song.
//
//   node tools/prototype-events.mjs     -> packages/audio/test/fixtures/demo-events.prototype.json
//
// Loads prototype/studio.template.html in headless Chromium with the kit's metadata but no audio
// (decoding fails quietly, which the prototype tolerates), replaces Engine.trigger/duck with
// recorders and runs the prototype's own renderOffline() on demoSong(). The port's event list
// must match this one (packages/audio/test/parity.test.ts).
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "packages/audio/test/fixtures/demo-events.prototype.json");

/** The prototype page as the artifact host served it, with metadata-only kit data. */
export function prototypePage() {
  const { alias, sounds } = JSON.parse(readFileSync(join(ROOT, "packages/song/src/kit-data.json"), "utf8"));
  const kit = sounds.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    note: s.note,
    dur: s.dur,
    peaks: s.peaks,
    b64: "",
  }));
  const tpl = readFileSync(join(ROOT, "prototype/studio.template.html"), "utf8");
  const html = tpl.replace("__ALIAS__", () => JSON.stringify(alias)).replace("__DATA__", () => JSON.stringify(kit));
  return (
    '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">' +
    "<style>[hidden]{display:none!important}</style></head><body>" +
    html +
    "</body></html>"
  );
}

/** Runs in the prototype page: demo song, recorded offline schedule. */
const RECORD = async () => {
  song = demoSong();
  const events = [],
    ducks = [];
  Engine.prototype.trigger = function (tr, id, time, o) {
    if (this.live) return;
    events.push({
      time,
      track: tr ? tr.name : null,
      sample: id,
      vel: o.vel == null ? 1 : o.vel,
      rate: o.rate || 1,
      end: o.end == null ? null : o.end,
      choke: o.choke == null ? null : o.choke,
    });
  };
  Engine.prototype.duck = function (tr, time) {
    if (!this.live) ducks.push({ time, track: tr.name });
  };
  await renderOffline();
  return { song: { name: song.name, bpm: song.bpm, swing: song.swing }, events, ducks };
};

export async function recordPrototypeEvents() {
  const dir = mkdtempSync(join(tmpdir(), "thk-proto-"));
  try {
    const file = join(dir, "page.html");
    writeFileSync(file, prototypePage());
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.route(/fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() => typeof renderOffline === "function");
      const out = await page.evaluate(RECORD);
      if (errors.length) throw new Error("prototype page errors: " + errors.join("; "));
      return out;
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await recordPrototypeEvents();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`${out.events.length} events, ${out.ducks.length} ducks -> ${OUT.slice(ROOT.length + 1)}`);
}
