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

## Phase 3 (started early, on request): the assistant through the API

**D13. `apps/api` runs Claude's tool loop on the server.** `POST /api/assistant` takes the song,
selection, request, recent turns and tier; it runs the six tools from `@thk/song` against a copy of
the song and returns the reply, every step's outcome, the edits that succeeded and any offered
variations. The browser replays those edits through the same tools as one undo step and shows the
variations as Try / Keep cards. Failed tool calls go back to Claude as errors and change nothing.

**D14. Model and settings.** Claude Opus 5.5 (`claude-opus-5-5`) for both modes; Fast is effort
`low`, Thorough is effort `high`. Rules and catalog are one cached system block. Server-side refusal
fallbacks are on (`fallbacks: "default"`). Per-client limit of 30 requests per 10 minutes; each request
logs its tokens and the running dollar cost of the session.

**D16. Personal use runs on the owner's Claude account, not an API key.** By default
`apps/api/src/account.ts` reaches Claude through the Claude Agent SDK, signed in the way Claude Code
is on this machine (`claude auth login`). Claude gets only the six studio tools on an in-process MCP
server (no built-in tools, no user settings), and they run through the same `runTool()` as the API
path, so the browser replays edits identically. Anthropic allows subscription sign-in only for the
owner's own use: before anyone else uses the app, set `ANTHROPIC_API_KEY` (or `THK_ASSISTANT=api`)
and the server switches to the API path (D13-D14).

`strictMcpConfig: true` keeps the SDK to the studio server. Without it the Claude Code CLI behind
the SDK also loads the account's claude.ai connectors (Gmail, Drive, Docs, Higgsfield: 173 tools,
~343 KB of schemas). They finish loading in the background, so from the second turn on every request
carried them, plus their server instructions. The kick request ("four-to-the-floor kick on a new
track called Groove, bars 1-4") cost 4 input + 38,758 cache read + 153,963 cache write (~193k
tokens) before and 4 + 16,629 + 856 (~17.5k) after. That is the same tool call and the same kind of
reply. The rest is the SDK's minimum: a one-line SDK preamble, an environment note (working
directory, model, date) and the account email. Each of the two turns resends ~8k tokens of rules,
catalog, song and tools, read from cache. `tools: []`, `settingSources: []`, a plain-string
`systemPrompt` and `persistSession: false` were already set. `--bare` would cut the rest, but it
skips subscription sign-in, so it isn't used.

**D15. Running it.** `pnpm dev` (tools/dev.mjs) starts the API on :5191 and Vite on :5190, which
proxies `/api`. The key comes from `ANTHROPIC_API_KEY` or `.env.local` (git-ignored; see
`.env.example`). Node runs the API's TypeScript directly (`--experimental-strip-types`), which is why
`kit.ts` imports its JSON with `with { type: "json" }`. Inside claude.ai the old `sample` runtime path
still works when the API has no key.

**Not done for Phase 3 yet:** `mix_check` and `set_macros` (they need Phase 2's mix engine), streaming
the reply as it is written, and accounts (the rate limit is per IP).

## Sounds: the sound maker (requested before Phase 2)

**D17. Sounds can be synth settings instead of recordings.** A `Patch` (packages/song/src/patch.ts)
describes a sound: two oscillators with unison, sub, noise, FM, a pitch drop, a filter with its own
envelope, an amp envelope, drive, and a length; or, with the sample engine, a kit sound trimmed,
reversed, pitched, filtered and enveloped. `packages/audio/src/synth.ts` renders a patch to a mono
sample in the browser (deterministic, seeded noise, peak-normalized to -1 dBFS). One parameter table
(`PARAMS`) drives clamping, the sound maker's knobs and the assistant's tool schema.

**D18. HANDOFF section 6 still holds.** A rendered patch is just a sample: melodic sounds are rooted on
C2 and synth tracks still play one sample chromatically; drum pads play them as one-shots. Export and
the parity tests are unchanged. The AI still only edits structured data: it sets synth parameters,
it never generates audio.

**D19. More sounds.** 55 factory presets (presets.ts) with permanent ids add five browser tabs (Leads,
Pads, Stabs, Plucks, FX) and extra basses and drums. They render on first use; there are no new
files. Only ever append presets.

**D20. Where the user's sounds live.** In `song.sounds` (so a song is self-contained and every
change is undoable) and in a "My sounds" library in localStorage that follows the user across songs.
Ids come from the sound's name (`user_rubber_acid`), so the server's tool run and the browser's replay
agree. Built-in sounds never change: editing one makes a copy.

**D21. The assistant makes and edits sounds** with `design_sound` (instrument, optional starting
sound, only the settings that matter, optionally onto a track or pad) and `edit_sound` (the song's own
sounds). The sound maker's "Describe it" box sends the same request through the chat.

**D22. Personal ChatGPT fallback (requested before the remaining mix work).** The local assistant can use the documented Codex app-server protocol with the owner's existing ChatGPT sign-in. Each turn starts an ephemeral thread with the shared studio tools and runs them through `runTool()` on a private copy. Models and supported reasoning efforts come from `model/list`. Auto retries operational Claude failures with ChatGPT; an explicit provider choice is respected. Cancellation and refusals do not trigger a provider retry. The browser keeps the same variation cards and one undo step, and labels the actual provider. App-server runs in a temporary directory with shell/apps/hooks/agents disabled, environment access disabled, and inherited MCP servers/plugins disabled for the thread. Credentials are managed by Codex and never sent to the browser. This personal connection uses ChatGPT's Codex models and limits, not ChatGPT web chat history.

**D23. Grouped instrument browser and starter chords/vocals.** The browser has seven navigation groups (Drums, Bass, Keys, Synths, Acoustic, Vocals, FX) covering the original sixteen and twelve added categories. Grouping does not change sound ids or existing category assignments. Only the new Chords and Vocals categories receive factory presets in this batch: eight each. Other new categories have an empty state and can be used for user-created sounds. All categories have sound-maker starting patches and are available to the AI tools.

Chord patches optionally specify a voicing (major, minor, minor7, major7, dominant7, sus2, sus4); one root note renders the full voicing. Vocal patches optionally specify a vowel (ah, eh, ee, oh, oo), shaped with parallel bandpass formants. These are explicitly labeled synthetic vowel chops/choir textures, with no recorded speech or lyrics. Both parameters are optional so old patches and factory sounds retain their rendering. The sixteen new factory definitions are appended after existing ones. Rendering checks cover chord pitches, formant spectral balance, levels, finiteness and legacy compatibility; browser checks cover navigation, assignment, editing and saved-song reload.

**D24. House chord expansion.** Forty original synth chord presets are appended after the existing factory definitions, bringing Chords to 48. They span Piano house, Organ & garage, Deep & soulful, Dub, Rave, Disco, Tech house and Minimal. All new presets have a style and short description; the original eight receive style metadata without changing their patches or ids. The chord browser can filter by style and preview at C2, C3 (default) or C4; preview transposition never changes the song. Copies retain their style metadata.

The patch engine adds optional FM attack decay (zero/missing retains constant-depth legacy behavior) and major/minor sixths, ninths, a minor eleventh and open triads. FM attack decay changes the strike's harmonic content over time for keyboard-like sounds. The sound maker and both AI providers share these settings, and the AI catalog includes chord styles/descriptions. Numerical tests cover chord frequencies, reduced late brightness, output levels and legacy compatibility. Browser tests cover style filtering, preview pitch, copying, editing and assignment.

References for the sound families: [Korg's M1 piano/organ overview](https://www.korg.com/us/products/software/kc_m1/) and [Roland's dance-sound synthesis guide](https://articles.roland.com/sound-design-edm-classics-with-the-system-8/). The pack contains original synthesized interpretations; it does not contain sampled hardware presets or exact recreations. Human listening remains the musical-quality check.

**D25. House essentials expansion.** A separate append-only `house-essentials.ts` adds 120 original synth recipes, bringing the combined kit/factory catalog to 346 sounds. Every category now has a factory sound. The ten previously empty categories receive six presets each; the remaining additions cover basses, leads, pads, stabs, plucks, synthetic vocals and drums. Chords remains at 48. New recipes include short descriptions for both the browser and the AI catalog. Piano, organ and other newly populated melodic categories preview above the bass register; preview transposition does not edit song notes.

The recipes use the existing deterministic patch renderer; no new audio assets, sample licenses or synthesis engine changes are introduced. Acoustic-style names describe synthesized interpretations. A fixture records the ids and patch hashes of all 111 earlier factory presets so future additions can verify that saved sounds remain stable. Render checks cover all presets' levels, finiteness, duration, piano decay and cymbal-swell timing; browser checks cover browsing populated categories, previews, assignments, undo, editing and saved-song reload.

**D26. Acoustic guitar presets.** Twelve original acoustic guitar-style patches append after the house essentials, bringing the catalog to 358 sounds and the Guitars category to 18. The set covers nylon and steel-string interpretations, soft picks, palm muting, folk and Latin plucks, octave doubling, harmonics, dry house chops and three full chord voicings. They use the existing oscillator/FM renderer and are labeled as synth interpretations; no recorded guitar assets or new DSP are introduced. Offline checks cover decaying envelopes, relative steel/nylon brightness and muted tails. Browser checks cover preview, assignment, undo and copying chord voicings into an editable sound.

**D27. Real recorded guitars.** The user clarified that acoustic and electric guitars must use the sound of an actual player. Two CC0 Shinyguitar instruments (D. Smolken / Karoryfer Samples) append to the catalog, now 360 sounds. The acoustic preset is the microphone recording of an archtop guitar; the electric preset is its clean magnetic pickup, without an amp. Seven recorded roots per instrument, two dynamic layers and two alternating takes keep playback close to the captured note and vary repeated picks. All 56 prepared takes, source paths, checksums and the license are bundled under `assets/recorded-guitars`; builds work without network access. Original kit/factory ids and audio stay unchanged.

`Sound.sampleMap` describes recorded zones. The shared live/offline engine resolves the nearest pitch, dynamic layer and take through the sample bank, with deterministic per-engine counters. Existing C2-based synth/kit playback is unchanged. The bank only marks an instrument ready after every zone has loaded, sharing in-flight file requests. Stop resets take selection. A C2 reference supports the existing sample editor; a copied recording becomes a single-sample edit rather than retaining the full instrument map. Recorded guitars appear first in the guitar browser and carry an explicit recorded label. The assistant is directed to these ids for realistic guitar requests. This uses sampled assets; the AI continues to edit visible note patterns.

Checks cover source licensing/checksums, levels, finite output, decay, dynamic and take selection, pitch correction, failed loads, deterministic WAV rendering, browser previews, assignment, undo and export. See `assets/recorded-guitars/README.md` for provenance and import processing.

**D28. Broad recorded library.** The catalog grows to 730 entries with 370 additions: 298 drum/percussion one-shots, 12 vocal phrases, 22 effects/transitions and 38 playable sampled instruments. The latter cover grand/upright pianos, sampled FM keyboards, organs, basses, nylon/steel guitars, strumstick, harps/kalimbas, mallets, strings and brass. Internal pitch/dynamic recordings do not count as additional presets. The expansion bundles 759 prepared WAVs (about 170 MB) under CC0 or explicit public-domain collection notices. Original permissions, pinned commits, exact file paths, source/prepared hashes and curation choices live under `assets/recorded-library`. Commercial-use-only/no-redistribution and noncommercial-only sample packs are excluded.

The importer uses an explicit plan, checks source hashes on re-import, keeps existing ids, downmixes/resamples/trims/fades recordings, preserves per-instrument dynamic relationships and excludes identical one-shot audio. Pitch mappings are calibrated per collection/instrument rather than assuming a universal filename octave; traditional Tanzanian mbira samples are gently tuned to their labeled keys. Standard builds copy bundled audio without network access and check all prepared hashes. The original kit and earlier factory/guitar audio remain intact.

The browser gains global text search, recorded/synth filters and sample-pack filters, with recorded entries labeled and placed first. Category changes clear search/pack selection. Waveforms/metadata are local; browsing no longer downloads whole categories. Preview/use/song loading brings in audio on demand. Sample copies retain pack metadata and remain editable. The AI catalog includes these recordings and explains that vocal phrases keep original timing on drum pads, without tempo stretching. Export now retains freely ringing one-shots plus their reverb after the last clip, so long phrases are not cut off by the old fixed tail.

Validation covers the complete bundle's checksums/permissions, finite samples, levels and boundaries; all sampled instrument previews and exports; pitch calibration for pianos/keys/harp/bass; long vocal export tails; global search and filtering without preloading; vocal speed/pad assignment; and regression checks for earlier songs, sound copies and undo. Musical quality still benefits from the owner's listening. Full source notes are in `assets/recorded-library/README.md`.

## Open items for the product owner

- HANDOFF.md section 9 questions are unchanged (pricing, reference sounds, platforms, name).
- Compressed playback format (D9) needs a decision after measurement.
- Recording and uploading audio for AI editing (requested next): HANDOFF lists audio recording as a
  non-goal and principle 1 says the AI never generates audio. Needs a decision on what "AI-edited
  audio" means before building (e.g. AI chops, pitches and arranges the recording through tools, versus
  AI rendering new audio).
- CI on GitHub (github.com/Tchaps147/thk-studio): check the Actions tab after each push; the strict kit check and the browser tests have only run on macOS so far.
