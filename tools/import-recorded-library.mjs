// Explicit, reproducible import. Dev/build use the resulting bundled WAVs without network access.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = join(root, "assets/recorded-library");
const plan = JSON.parse(readFileSync(join(dir, "import-plan.json"), "utf8"));
const cache = join(tmpdir(), "thk-recorded-library-source");
mkdirSync(cache, { recursive: true });
mkdirSync(join(dir, "licenses"), { recursive: true });
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const raw = (source, path) => {
  const s = plan.sources[source];
  return `https://raw.githubusercontent.com/${s.repo}/${s.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
};
async function download(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url);
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
    if (r.status < 500 || attempt === 2) throw new Error(`${r.status}: ${url}`);
  }
  throw new Error(`Failed: ${url}`);
}
for (const [key, source] of Object.entries(plan.sources)) {
  const bytes = await download(raw(key, source.licensePath));
  writeFileSync(join(dir, "licenses", key + ".txt"), bytes);
}
for (const machine of ["CR-78", "MRK-2", "TR-505"]) {
  writeFileSync(join(dir, "licenses", machine + ".txt"), await download(raw("oramics", `DM/${machine}/README.md`)));
}
const files = [
  ...new Map(plan.sounds.flatMap((s) => s.files.map((f) => [f.asset, { ...f, source: s.source }]))).values(),
];
const previous = existsSync(join(dir, "manifest.json"))
  ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
  : null;
const plannedIds = new Set(plan.sounds.map((s) => s.id));
for (const sound of previous?.sounds ?? []) {
  if (!plannedIds.has(sound.id)) throw new Error(`Cannot remove permanent library id: ${sound.id}`);
}
const previousHash = new Map(
  (previous?.files ?? [])
    .filter((f) => f.sourcePath)
    .map((f) => ["REC_" + sha256(plan.sources[f.source].repo + "/" + f.sourcePath).slice(0, 20), f.sourceSha256]),
);
let next = 0,
  done = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < files.length) {
      const f = files[next++],
        path = join(cache, f.asset);
      const bytes = existsSync(path) ? readFileSync(path) : await download(raw(f.source, f.path));
      const digest = sha256(bytes);
      if (previousHash.has(f.asset) && previousHash.get(f.asset) !== digest)
        throw new Error(`Source changed: ${f.path}`);
      writeFileSync(path, bytes);
      f.sourceSha256 = digest;
      if (++done % 100 === 0) console.log(`Downloaded ${done}/${files.length} source recordings`);
    }
  }),
);
writeFileSync(join(cache, "index.json"), JSON.stringify(files));
const result = spawnSync(join(root, ".venv/bin/python"), [join(root, "tools/prepare-recorded-library.py"), cache], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
