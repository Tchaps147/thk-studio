// Starts the assistant API and the web app together; Ctrl+C stops both.
//
//   node tools/dev.mjs            dev server on :5190 (hot reload)
//   node tools/dev.mjs preview    production build served on :4190
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const vite = join(ROOT, "apps/web/node_modules/vite/bin/vite.js");
const preview = process.argv[2] === "preview";
const run = (args) => spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit" });

const kit = run(["tools/kit-web.mjs"]);
kit.on("exit", (code) => {
  if (code) process.exit(code);
  const procs = [run(["--experimental-strip-types", "--no-warnings", "apps/api/src/server.ts"])];
  if (preview) {
    const build = run([vite, "build", "apps/web"]);
    build.on("exit", (c) => (c ? stopAll(c) : procs.push(run([vite, "preview", "apps/web"]))));
  } else procs.push(run([vite, "apps/web"]));
  const stopAll = (c = 0) => {
    procs.forEach((p) => p.kill());
    process.exit(c);
  };
  process.on("SIGINT", () => stopAll());
  process.on("SIGTERM", () => stopAll());
  procs[0].on("exit", (c) => c && stopAll(c));
});
