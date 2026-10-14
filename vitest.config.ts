import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/api/test/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 30000,
  },
});
