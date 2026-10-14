#!/bin/sh
# Runs every CI check locally. Uses node directly (npm/pnpm start-up is slow on some Macs).
set -e
cd "$(dirname "$0")/.."
PY=${PY:-.venv/bin/python}
node tools/kit-web.mjs --check
node node_modules/eslint/bin/eslint.js .
node node_modules/prettier/bin/prettier.cjs --check . > /dev/null
for p in packages/song packages/audio apps/web e2e; do node node_modules/typescript/bin/tsc -p $p; done
echo "types ok"
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js test
$PY tools/sound-engine/verify_kit.py --md5
$PY tools/reproduce_kit.py --lsb "${KIT_LSB:-0}"
