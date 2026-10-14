# Decisions

Choices made while doing Phase 0 and Phase 1 that HANDOFF.md doesn't spell out, and where the port
differs from the prototype. HANDOFF.md section 6 still holds; nothing here changes it.

## Phase 0: repository

**D1. pnpm workspaces, packages used as TypeScript source.** `@thk/song` and `@thk/audio` export
`src/index.ts` directly; Vite and Vitest compile them, so there is no package build step.
pnpm 9 is pinned in `package.json` (`corepack enable`, or `corepack pnpm …`).

**D2. The sound engine moved to `tools/sound-engine/` unchanged.** The only edit is the relative
path to `assets/` in `synth_kit.py` and `verify_kit.py` (one more `..`). Render order, seeds and DSP
are untouched.

**D3. Reproducing the kit.** `tools/reproduce_kit.py` renders the kit into a temp folder and compares
it with `assets/checksums.md5`. On an Apple Silicon Mac (numpy 2.5, scipy 1.18) 113 of 115 files are
bit-identical; `Bass_01_Sub_Pluck` and `Bass_10_Sub_Sustain` each differ by 1 LSB (24-bit) in one
sample, about -138 dBFS, a floating-point rounding difference between CPUs. `--lsb 1` reports those
separately. CI runs the strict check on Linux x86; that hasn't run yet because the repo has no remote.

**D4. One local command for every CI check:** `tools/check-all.sh` (calls node directly; npm and
pnpm can be slow to start on this machine).

## Phase 1: port

**D5. Command-based undo with Immer patches** (`apps/web/src/lib/history.ts`). Each edit is a
command holding forward and inverse patches. Slider drags with the same key within 1.5 s merge into
one step. An assistant turn and a kept variation are one command each.

**D6. Everything is undoable.** The prototype didn't record volume, pan, filter, reverb, mute, solo,
tempo or swing changes; the port does (coalesced for sliders).

**D7. Drags preview from where they started.** A gesture (moving a clip or note, drawing a note)
re-applies its recipe to the song as it was at pointer-down on every move, and records one command
on release.

**D8. A pending Try settles on any other edit.** If the user edits, undoes or tries a card in another
group while a Try is looping, that Try is kept first, so history never mixes a preview with real
edits. (The prototype's behaviour in this case was undefined.)

**D9. Samples: 16-bit WAV for both playback and export, loaded lazily.** `tools/kit-web.mjs` writes
`apps/web/public/kit/<id>.wav` (the same format the prototype embedded) and the catalog
`packages/song/src/kit-data.json`. The browser loads the song's sounds first, a category when its
tab opens, and anything else on first audition. **Not done yet:** Opus or AAC for playback, as the
plan suggests. AAC encoders add priming silence (about 48 ms at 44.1 kHz) that browsers trim
inconsistently, which would put every hit late, so it needs a measured test before switching. The
whole kit is 5.9 MB as 16-bit WAV.

**D10. Parity is checked against the prototype's own event list.** `tools/prototype-events.mjs` runs
the prototype's `renderOffline()` on its demo song in headless Chromium with recording stubs and saves
`packages/audio/test/fixtures/demo-events.prototype.json` (940 voices, 224 ducks). The port's offline
render must schedule exactly those (same times, sounds, pitches, velocities, gates, chokes).

**D11. Level checks run where the browser runs.** node-web-audio-api's compressor lets the demo peak
at about 1.04 in float; Chromium keeps it at or under 1.0, which the e2e test asserts as the prototype
did. Node tests check level range, timing (every kick on the grid within one sample) and ducking.

**D12. Assistant and saving outside claude.ai.** The assistant still talks to Claude through the
artifact runtime's `sample` interface; outside claude.ai it shows the prototype's "not available"
message and grooves and variations keep working. Phase 3 replaces the sampler with `apps/api`. Export
downloads the zip directly. Cloud save and open are left out until Phase 5, as the plan allows.

## Open items for the product owner

- HANDOFF.md section 9 questions are unchanged (pricing, reference sounds, platforms, name).
- Compressed playback format (D9) needs a decision after measurement.
- CI hasn't run on GitHub yet: the repo has no remote and nothing is committed.
