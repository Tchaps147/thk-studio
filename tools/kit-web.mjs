// Prepares the sound kit for the web app.
//
//   node tools/kit-web.mjs           write packages/song/src/kit-data.json and apps/web/public/kit/*
//   node tools/kit-web.mjs --check   fail if kit-data.json is out of date with assets/
//
// kit-data.json: catalog metadata (id, kind, name, note, hz, dur, 60-bin peak envelope), in the
// prototype's order (category, then file name). public/kit/<id>.wav: 16-bit PCM copies, the same
// format the prototype embedded. Pure Node: no Python or encoder needed.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");
const KIT = join(ASSETS, "TechHouse_Synth_Kit");
const DATA_OUT = join(ROOT, "packages/song/src/kit-data.json");
const AUDIO_OUT = join(ROOT, "apps/web/public/kit");
const ORDER = ["kick", "clap", "snare", "hat_closed", "hat_open", "ride", "shaker", "rim", "perc", "tom", "bass"];

/** Reads a PCM WAV into Float32 samples (mono or first channel). */
export function readWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt = null,
    data = null;
  for (let o = 12; o + 8 <= buf.length;) {
    const id = tag(o),
      size = dv.getUint32(o + 4, true);
    if (id === "fmt ")
      fmt = {
        channels: dv.getUint16(o + 10, true),
        rate: dv.getUint32(o + 12, true),
        bits: dv.getUint16(o + 22, true),
      };
    if (id === "data") data = { offset: o + 8, size };
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV without fmt or data chunk");
  const bytes = fmt.bits / 8,
    frames = Math.floor(data.size / (bytes * fmt.channels)),
    out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const o = data.offset + i * bytes * fmt.channels;
    if (fmt.bits === 24) {
      let v = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      out[i] = v / 8388608;
    } else if (fmt.bits === 16) out[i] = dv.getInt16(o, true) / 32768;
    else throw new Error(`unsupported bit depth ${fmt.bits}`);
  }
  return { rate: fmt.rate, samples: out };
}

/** 16-bit mono WAV, rounding like soundfile's PCM_16 writer (scale by 32768, clip). */
function writeWav16(samples, rate) {
  const n = samples.length,
    dv = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), true);
  return new Uint8Array(dv.buffer);
}

/** Max |x| over 60 near-equal chunks, like numpy.array_split(abs(x), 60). */
function peaks(samples, bins = 60) {
  const n = samples.length,
    base = Math.floor(n / bins),
    extra = n % bins,
    out = [];
  let o = 0;
  for (let b = 0; b < bins; b++) {
    const len = base + (b < extra ? 1 : 0);
    let m = 0;
    for (let i = o; i < o + len; i++) m = Math.max(m, Math.abs(samples[i]));
    out.push(Math.round(m * 1000) / 1000);
    o += len;
  }
  return out;
}

function main() {
  const check = process.argv.includes("--check");
  const meta = JSON.parse(readFileSync(join(ASSETS, "kit_meta.json"), "utf8"));
  const alias = JSON.parse(readFileSync(join(ASSETS, "kit_alias.json"), "utf8"));
  meta.sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
  const sounds = [];
  if (!check) mkdirSync(AUDIO_OUT, { recursive: true });
  for (const m of meta) {
    const src = join(KIT, m.file),
      id = basename(m.file, ".wav");
    const { rate, samples } = readWav(readFileSync(src));
    sounds.push({ id, kind: m.kind, name: m.name, note: m.note, hz: m.hz, dur: m.dur, peaks: peaks(samples) });
    if (check) continue;
    const dest = join(AUDIO_OUT, id + ".wav");
    if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs)
      writeFileSync(dest, writeWav16(samples, rate));
  }
  const json = JSON.stringify({ alias, sounds }, null, 0).replace(/},{"id"/g, '},\n{"id"') + "\n";
  if (check) {
    const cur = existsSync(DATA_OUT) ? readFileSync(DATA_OUT, "utf8") : "";
    if (cur !== json) {
      console.error("packages/song/src/kit-data.json is out of date. Run: pnpm kit:web");
      process.exit(1);
    }
    console.log(`kit-data.json matches assets (${sounds.length} sounds)`);
    return;
  }
  writeFileSync(DATA_OUT, json);
  console.log(`${sounds.length} sounds -> packages/song/src/kit-data.json, apps/web/public/kit/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
