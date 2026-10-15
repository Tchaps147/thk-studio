// Reproducible import of a small CC0 Shinyguitar subset. Run explicitly, not during builds.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readWav, writeWav16 } from "./kit-web.mjs";

const DIR = new URL("../assets/recorded-guitars/", import.meta.url);
const COMMIT = "57243cca85277dbcc120ce17c6178032f93c80f3";
const BASE = `https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/${COMMIT}/`;
const ROOTS = [
  [37, "db2"],
  [42, "gb2"],
  [48, "c3"],
  [54, "gb3"],
  [60, "c4"],
  [66, "gb4"],
  [72, "c5"],
];
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
mkdirSync(DIR, { recursive: true });
const fetchBytes = async (path) => {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};
writeFileSync(new URL("LICENSE.txt", DIR), await fetchBytes("LICENSE"));
const instruments = [];
for (const channel of ["acoustic", "electric"]) {
  const label = channel === "acoustic" ? "Acoustic" : "Electric";
  const id = `THK_RecordedGuitar_0${instruments.length + 1}_${label}`;
  const tasks = ROOTS.flatMap(([root, note]) =>
    [2, 4].flatMap((velocity) =>
      [1, 2].map((take) => ({
        root,
        velocity,
        take,
        source: `Samples/${channel}/${note}_vl${velocity}_rr${take}_${channel === "acoustic" ? 1 : 2}.wav`,
        file: `GTR_${label}_${root}_v${velocity}_rr${take}`,
      })),
    ),
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < tasks.length) {
        const t = tasks[next++];
        const bytes = await fetchBytes(t.source);
        const { samples, rate } = readWav(bytes);
        if (rate !== 44100) throw new Error(`Unexpected rate: ${rate}`);
        t.sourceSha256 = sha256(bytes);
        // Preserve the pick attack and five seconds of natural body; keep 3 ms of onset room.
        let onset = samples.findIndex((x) => Math.abs(x) > 0.003);
        onset = Math.max(0, onset - Math.round(rate * 0.003));
        const d = samples.slice(onset, Math.min(samples.length, onset + rate * 5));
        const dc = d.reduce((sum, x) => sum + x, 0) / d.length;
        for (let i = 0; i < d.length; i++) {
          const fade = Math.min(1, i / (rate * 0.001), (d.length - 1 - i) / (rate * 0.03));
          d[i] = (d[i] - dc) * fade;
        }
        t.samples = d;
      }
    }),
  );
  let peak = 0;
  for (const t of tasks) for (const x of t.samples) peak = Math.max(peak, Math.abs(x));
  // One gain per instrument preserves the recorded soft/hard dynamics and take differences.
  const gain = 0.891 / peak;
  for (const t of tasks) {
    for (let i = 0; i < t.samples.length; i++) t.samples[i] *= gain;
    const wav = writeWav16(t.samples, 44100);
    t.sha256 = sha256(wav);
    writeFileSync(new URL(t.file + ".wav", DIR), wav);
  }
  // A C2 reference is kept for the existing sound maker's sample-copy workflow.
  const reference = tasks.find((t) => t.root === 37 && t.velocity === 4 && t.take === 1).samples;
  const rate = 2 ** (-1 / 12);
  const c2 = new Float32Array(Math.floor(reference.length / rate));
  for (let i = 0; i < c2.length; i++) {
    const pos = i * rate,
      a = Math.floor(pos),
      fraction = pos - a;
    c2[i] = reference[a] * (1 - fraction) + reference[Math.min(a + 1, reference.length - 1)] * fraction;
  }
  const referenceWav = writeWav16(c2, 44100);
  writeFileSync(new URL(id + ".wav", DIR), referenceWav);
  instruments.push({
    id,
    kind: "guitar",
    name: `Recorded ${label} Guitar`,
    description:
      channel === "acoustic"
        ? "Real archtop guitar recorded with a microphone. Soft and hard picks with alternating takes."
        : "Real guitar recorded from its electric pickup. Clean, unamped tone with soft and hard picks and alternating takes.",
    sampleMap: ROOTS.flatMap(([root]) =>
      [2, 4].map((v) => ({
        root,
        maxVelocity: v === 2 ? 0.65 : 1,
        files: tasks.filter((t) => t.root === root && t.velocity === v).map((t) => t.file),
      })),
    ),
    referenceSha256: sha256(referenceWav),
    files: tasks.map((t) => ({
      root: t.root,
      velocity: t.velocity,
      take: t.take,
      source: t.source,
      file: t.file,
      sourceSha256: t.sourceSha256,
      sha256: t.sha256,
    })),
  });
  console.log(`${label}: ${tasks.length} recorded picks`);
}
writeFileSync(
  new URL("manifest.json", DIR),
  JSON.stringify(
    {
      source: "https://github.com/sfzinstruments/karoryfer.shinyguitar",
      commit: COMMIT,
      author: "D. Smolken / Karoryfer Samples",
      license: "CC0-1.0",
      instruments,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Imported guitars to ${join(DIR.pathname)}`);
