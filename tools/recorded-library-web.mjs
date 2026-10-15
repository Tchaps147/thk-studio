import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";

const DIR = new URL("../assets/recorded-library/", import.meta.url);
const OUT = new URL("../apps/web/public/kit/", import.meta.url);
const DATA = new URL("../packages/song/src/recorded-library-data.json", import.meta.url);

export function prepareRecordedLibrary(check) {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", DIR), "utf8"));
  const json = JSON.stringify(manifest.sounds, null, 2) + "\n";
  if (check) {
    if (!existsSync(DATA) || readFileSync(DATA, "utf8") !== json)
      throw new Error("Recorded library metadata is stale. Run node tools/kit-web.mjs");
    for (const f of manifest.files) {
      const b = readFileSync(new URL(f.asset + ".wav", DIR));
      if (createHash("sha256").update(b).digest("hex") !== f.sha256)
        throw new Error(`Recording checksum mismatch: ${f.asset}`);
    }
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const f of manifest.files) {
      const src = new URL(f.asset + ".wav", DIR),
        dest = new URL(f.asset + ".wav", OUT);
      if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) copyFileSync(src, dest);
    }
    const current = new Set(manifest.files.map((f) => f.asset + ".wav"));
    for (const name of readdirSync(OUT)) {
      if ((name.startsWith("REC_") || name.startsWith("THK_Library_")) && name.endsWith(".wav") && !current.has(name))
        unlinkSync(new URL(name, OUT));
    }
    writeFileSync(DATA, json);
  }
  console.log(`${manifest.sounds.length} library sounds ready (${manifest.files.length} bundled audio files)`);
}
