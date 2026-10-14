# THK Studio

A browser app where anybody can make great tech house: an arrangement + piano roll, a synthesized sound library, and an AI co-producer that edits patterns through tools. The working prototype is in `prototype/`; the sound library and its generator are in `assets/` and `tools/sound-engine/`. The port lives in `packages/song` (pure song logic), `packages/audio` (engine, scheduler, offline render) `apps/web` (React app) and `apps/api` (the assistant's server-side tool loop). Decisions made during the port are in `docs/decisions.md`.

**Read `HANDOFF.md` first.** It covers the product principles, how the prototype works, decisions already made, and the phased plan. Work phase by phase; don't start a phase before the previous one's acceptance criteria pass.

## Commands

```bash
corepack pnpm install                         # JS deps (pnpm 9)
pip install -r requirements.txt               # Python deps for the sound engine
pnpm dev                                      # studio at http://localhost:5190 + assistant API on :5191
# the assistant needs ANTHROPIC_API_KEY in .env.local (copy .env.example)
pnpm test                                     # Vitest: song logic, audio engine, parity with the prototype
pnpm test:e2e                                 # Playwright against a production build on :4190
pnpm lint && pnpm typecheck
node tools/kit-web.mjs                        # catalog + web copies of the kit (dev/build run it)
node tools/prototype-events.mjs               # re-record the prototype's demo event list (parity fixture)
python tools/sound-engine/verify_kit.py --md5 # sound checks + checksums
python tools/reproduce_kit.py                 # re-render the kit and compare with checksums.md5
sh tools/check-all.sh                         # every CI check, locally
```

The prototype itself: `python prototype/build_studio.py && python prototype/tests/smoke_prototype.py`.

## Rules

- **You can't listen to audio, so measure it.** Every audio change gets a test that renders offline and checks numbers: levels, LUFS, pitch, timing, spectral balance. Never claim something "sounds better" without a measurement or a human listening.
- **Sound ids are permanent.** Renames go through `assets/kit_alias.json`; saved songs migrate on load.
- **The sound engine is deterministic.** Only append renders after existing ones in `build_kit.py`; never reorder or change seeds. Run `verify_kit.py --md5` before committing anything under `sound-engine/`.
- **Song logic is pure.** Pattern code (`writeClip`, `carve`, `tile`, step parsing, pad resolution) lives in a DOM-free package with unit tests, because the server reuses it for the assistant.
- **Every edit is undoable, and each assistant turn is exactly one undo step.** A failed tool call must leave the song unchanged.
- **Suggestions are Try / Keep cards.** Don't add a second way of applying AI or preset changes.
- Keep the prototype in `prototype/` untouched as the reference implementation until the port reaches parity.
- When the plan and the code disagree, or a decision in HANDOFF.md section 6 looks wrong, stop and ask rather than quietly changing direction.
