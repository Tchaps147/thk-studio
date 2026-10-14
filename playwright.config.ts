import { defineConfig, devices } from "@playwright/test";

const vite = "node apps/web/node_modules/vite/bin/vite.js";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4190",
    ...devices["Desktop Chrome"],
    viewport: { width: 1500, height: 1000 },
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    // Production build: the dev server can reload mid-test when other tools touch files.
    command: `node tools/kit-web.mjs && ${vite} build apps/web && ${vite} preview apps/web`,
    url: "http://localhost:4190",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
