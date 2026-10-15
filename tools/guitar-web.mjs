// Prepare bundled recordings without a network dependency during dev/build.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readWav } from "./kit-web.mjs";

const DIR = new URL("../assets/recorded-guitars/", import.meta.url);
const OUT = new URL("../apps/web/public/kit/", import.meta.url);
const DATA = new URL("../packages/song/src/recorded-data.json", import.meta.url);

export function prepareGuitars(check) {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", DIR), "utf8"));
  if (check) {
    for (const s of manifest.instruments) {
      for (const f of [{ file: s.id, sha256: s.referenceSha256 }, ...s.files]) {
        const hash = createHash("sha256")
          .update(readFileSync(new URL(f.file + ".wav", DIR)))
          .digest("hex");
        if (hash !== f.sha256) throw new Error(`Recorded guitar checksum mismatch: ${f.file}`);
      }
    }
  }
  const sounds = manifest.instruments.map(({ id, kind, name, description, sampleMap }) => {
    const { samples, rate } = readWav(readFileSync(new URL(id + ".wav", DIR)));
    const peaks = Array.from({ length: 60 }, (_, n) => {
      let peak = 0;
      for (let i = Math.floor((n * samples.length) / 60); i < Math.floor(((n + 1) * samples.length) / 60); i++)
        peak = Math.max(peak, Math.abs(samples[i]));
      return Math.round(peak * 1000) / 1000;
    });
    return {
      id,
      kind,
      name,
      description,
      note: "",
      hz: 0,
      dur: samples.length / rate,
      peaks,
      sampleMap,
      recording: {
        pack: "Shinyguitar",
        author: "D. Smolken / Karoryfer Samples",
        license: "CC0-1.0",
        source: "https://github.com/sfzinstruments/karoryfer.shinyguitar",
      },
    };
  });
  const json = JSON.stringify(sounds, null, 2) + "\n";
  if (check) {
    if (!existsSync(DATA) || readFileSync(DATA, "utf8") !== json)
      throw new Error("Recorded guitar metadata is out of date. Run node tools/kit-web.mjs");
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const s of manifest.instruments) {
      for (const file of [s.id, ...s.files.map((f) => f.file)]) {
        const src = new URL(file + ".wav", DIR),
          dest = new URL(file + ".wav", OUT);
        if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) copyFileSync(src, dest);
      }
    }
    copyFileSync(new URL("LICENSE.txt", DIR), new URL("GUITAR-LICENSE.txt", OUT));
    writeFileSync(DATA, json);
  }
  console.log(`${sounds.length} recorded guitars ready (56 pitch/velocity/take samples)`);
}
