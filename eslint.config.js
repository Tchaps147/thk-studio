import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "prototype/**",
      "tools/sound-engine/**",
      "apps/web/public/**",
      "test-results/**",
      "playwright-report/**",
      ".venv/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web/**/*.tsx", "apps/web/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Runs inside the prototype page, where these are the prototype's own globals.
    files: ["tools/prototype-events.mjs"],
    languageOptions: {
      globals: { song: "writable", demoSong: "readonly", renderOffline: "readonly", Engine: "readonly" },
    },
  },
);
