# THK Studio — handoff

A browser app where anybody can make great tech house. This folder holds everything built so far in a claude.ai prototype session and the plan for turning it into a real product. Read sections 1–4 before writing code; section 7 is the work plan.

---

## 1. The product

**One line:** an AI co-producer for tech house that writes and edits real, visible patterns, so a beginner can make a full track that sounds professional and still feel like they made it.

**Principles (these drive every design call):**

1. **The AI edits structure, never generates audio.** Kicks, hats and basslines stay visible as clips and notes the user can see, change, undo and export. This is the difference from Suno/Udio, where you get a song you can't edit.
2. **Try / Keep is the core interaction.** Beginners can't judge a change on its own, but anyone can A/B two versions. Every suggestion (AI variations, groove presets, later mix fixes) arrives as cards: Try loops it in place, Keep commits it, Back to original restores.
3. **It should sound good before anyone touches a knob.** Genre-tuned defaults everywhere: tuned kicks, bass that ducks to the kick, a sensible mix chain per sound type.
4. **Every AI turn is one undo step.** Users must never fear the assistant.
5. **Fun matters.** Fast feedback, pads lighting up, hits you can see. (Phase 6.)
6. **Full songs, no dead ends.** Export WAV + MIDI so a track can be finished in Ableton.

**Non-goals for now:** a general-purpose DAW, audio recording, other genres, real-time collaboration.

**Later (after the maker is genuinely good):** a learning hub with structured lessons, endless practice and achievements, ending in mastery of tech house. Design the maker so lessons can drive it (load a song state, check a pattern, highlight a control).

---

## 2. What's in this folder

```
CLAUDE.md                         working rules for Claude Code
HANDOFF.md                        this file
requirements.txt                  Python deps for the sound engine and prototype tests
assets/
  TechHouse_Synth_Kit/            115 WAVs (44.1 kHz, 24-bit mono), one folder per category
  kit_meta.json                   file, kind, name, note, Hz, duration for every sound
  kit_alias.json                  old v2 ids -> current ids (12 percussion sounds were re-filed)
  checksums.md5                   md5 of every WAV, for reproducibility checks
  KIT_README.txt                  the kit's user-facing README
sound-engine/
  synth_kit.py                    DSP helpers, kick engine, bass engine, original 12 perc
  drums2.py                       categorized drum generators (claps, snares, hats, rides, shakers, rims, perc, toms)
  build_kit.py                    renders the whole kit deterministically
  verify_kit.py                   format/level/DC/tuning checks, optional checksum compare
prototype/
  studio.template.html            the whole prototype app (HTML/CSS/JS, ~1,600 lines)
  build_studio.py                 embeds the kit into the template -> prototype/dist/studio.html
  tests/smoke_prototype.py        headless end-to-end test of the built prototype
```

Commands:

```bash
pip install -r requirements.txt && python -m playwright install chromium
python sound-engine/build_kit.py            # regenerate assets/ (optional; assets are committed)
python sound-engine/verify_kit.py --md5     # quality checks + checksums
python prototype/build_studio.py            # build prototype/dist/studio.html
python prototype/tests/smoke_prototype.py   # end-to-end smoke test
```

The built prototype was published as a private claude.ai artifact and depends on the artifact runtime (`window.claude`) for cloud save, export and the assistant. Opened as a plain file, those three features hide themselves and everything else works.

---

## 3. The prototype: what works today

All verified in headless Chromium (see `prototype/tests/smoke_prototype.py`).

| Area | What it does |
|---|---|
| Transport | Play/stop, return to start, loop (drag on the ruler), BPM 80–170, swing 50–66%, song key, position readout (bar.beat.16th) |
| Arrangement | Tracks × bars. Draw a clip by dragging in a lane, move clips, drag the right edge to extend (the pattern repeats), zoom, follow playhead, end-of-song marker |
| Tracks | Drum tracks (8 pads, any sound per pad) and synth tracks (one sample played chromatically). Volume, mute, solo, low-pass filter, reverb send, pan; synth tracks also mono and "duck to kick" |
| Piano roll | Synth: keys C1–C5. Drums: one row per pad with a sound picker. Click to add, drag to move, drag edge to resize, click to delete, Shift-click for a soft hit. Pattern length 1–16 bars, transpose, duplicate, clear |
| Sound browser | 115 sounds in 11 tabs (Kicks, Claps, Snares, Closed hats, Open hats, Rides, Shakers, Rims, Perc, Toms, Bass); click to audition, Use to assign to the selected track or pad |
| Grooves | 11 drum and 10 bass presets; bass presets follow the song key |
| Variations | "3 variations" makes three alternatives for the selected clip; Try / Keep / Back to original |
| Assistant | Chat that edits the song through six tools (section 4.7); "show me N variations" returns Try/Keep cards |
| History | Undo/redo of every edit; each assistant turn is one step |
| Saving | Autosave to localStorage; named songs saved to the viewer's account (artifact db) |
| Export | Offline render of the whole song to a zip with a 16-bit stereo WAV, a MIDI file and a README |
| Demo | "Late Shift", 32 bars in F at 125 BPM: kick, tops, rolling bass, organ stabs, a break with a snare roll |

---

## 4. How the prototype works

Everything is in `prototype/studio.template.html`. Function names below are searchable in that file.

### 4.1 Constants and conventions

- **16 steps per bar** (`SPB`), 16th-note grid. Bars are 0-based in data, 1-based in the UI and in everything the assistant sees.
- **Pitch** is MIDI with C4 = 60. Synth notes are clamped to 24–72 (C1–C5).
- **Every bass sample is rooted on C2 = MIDI 36 = 65.41 Hz** (`ROOT`). A note plays at `playbackRate = 2^((p - 36) / 12)`.
- **Kicks are tuned**; the note is the last part of the id (`THK_Kick_20_Big_Tech_F`, `s` = sharp).
- **Sound ids** are file stems: `THK_<Prefix>_<NN>_<Name>`. Ids are permanent. If a file must be renamed, add the old id to `kit_alias.json`; `migrate()` rewrites saved songs on load.
- **Song key** is a pitch class 0–11 (`song.key`, default 5 = F). Bass grooves are built on `36 + key`.

### 4.2 Song data model

```jsonc
{
  "v": 1, "name": "Late Shift (demo)", "bpm": 125, "swing": 54, "key": 5,
  "loop": { "on": false, "userSet": false, "start": 8, "end": 16 },   // bars, end exclusive
  "cloudId": "s…",                                                      // set after the first cloud save
  "tracks": [{
    "id": "…", "name": "Kick", "type": "drums",                          // or "synth"
    "color": 0, "vol": 0.92, "pan": 0, "cutoff": 20000, "send": 0, "mute": false, "solo": false,
    "pads": ["THK_Kick_20_Big_Tech_F", "THK_Clap_01_Classic", …],      // drums: 8 sound ids (null = empty)
    // synth instead: "sample": "THK_Bass_02_Rolling_Saw_Pluck_C", "mono": true, "duck": true
    "clips": [{
      "id": "…", "name": "Four to the floor",
      "start": 0, "len": 24,        // bars in the arrangement
      "loop": 1,                    // pattern length in bars; the pattern repeats across len
      "notes": [{ "t": 0, "d": 1, "p": 0, "v": 1 }]   // t, d in steps within the pattern; p = pad index (drums) or MIDI pitch (synth); v velocity 0–1
    }]
  }]
}
```

Invariants: clips on one track never overlap; notes with `t >= loop*16` are kept but not played; a note's sounding length is clamped to the clip end.

### 4.3 Audio engine (`class Engine`)

Per-track graph: `source → note gain → lowpass filter → duck gain → volume → stereo panner → master`, plus `panner → send gain → convolver reverb → master`. Master: gain → `DynamicsCompressor` (−10 dB threshold, 6:1) → destination. Volume uses `vol² × 1.2`.

- **Voices and chokes** (`trigger`): mono synth tracks choke the previous note; each drum pad chokes itself; closed and open hats share a "hat" choke group. Choking cancels the old voice's gain automation and fades it in 6 ms.
- **Sidechain** (`duck`): every kick hit on an audible drum track dips the duck gain of every synth track with `duck: true` to 0.3 in 8 ms and recovers by 190 ms.
- **Notes on synth tracks** are gated: gain holds until the note end, then a 25 ms release.
- The same class runs live and offline (`live` flag switches between smoothed and immediate parameter changes).

### 4.4 Scheduling

Classic lookahead scheduler (`play`, `pump`, `frame`): a 25 ms interval schedules every 16th step that starts within the next 120 ms. `getTable()` precomputes `step → events` for the whole song and is rebuilt only when `songVer` changes. Swing delays odd 16ths by `(swing − 50) / 50 × stepDur`. The playhead is interpolated from `[audioTime, step]` anchors in `requestAnimationFrame`. Without loop, playback stops at the end of the last clip.

### 4.5 Writing patterns (shared by grooves, variations and the assistant)

- `writeClip(track, start, len, loop, makeNotes, name)` replaces whatever the track had in `[start, start+len)` with one new clip. `makeNotes(base)` receives the notes previously audible at `start`, re-tiled to the new pattern length, so callers can merge.
- `carve(track, a, b)` removes the bar range, shortening clips that start before it and splitting clips that run past it. The right-hand piece is re-phased with `tile()` so it sounds exactly as before.
- `tile(clip, offsetSteps, L)` returns a clip's notes as heard from an offset, for a window of `L` steps.
- `writeDrums({track, start, len, loop, lanes, replace})`: lanes are `{sound, steps}`. `sound` is a category or an id; `resolvePad()` maps it to a pad: an existing pad with that id, else a pad of the same category, else a free pad (it never steals a pad used by notes). Without `replace`, lanes not listed are kept.
- `writeNotes({track, start, len, loop, notes, sound})`: notes are `{step, note: "F2" | midi, len, soft}`.
- **Step strings:** one character per 16th: `x` hit (v=1), `o` soft (v=0.55), `-` or `.` rest. Spaces and `|` are ignored; shorter strings tile.

### 4.6 Variations (Try / Keep / Back)

A variation spec is the input to `writeDrums` or `writeNotes` plus `{name, why, kind}`. A card group holds `base` (the song JSON before the first Try). Try restores `base`, applies the chosen spec, loops its first max(4, 2 × pattern length) bars and starts playback. Keep pushes `base` onto the undo stack and clears it. Back to original restores `base`. Trying in another group first commits the pending one. `localVariations()` builds three alternatives from the groove library without AI; for drums it keeps the clip's own kick lane, or leaves the kick out when another track already plays one there.

### 4.7 Assistant

Uses the artifact `sample` capability (Claude on the viewer's own account) with page-side tools. **This has to move server-side** (Phase 3), but the design carries over directly.

- **Input per request:** `[RULES + sound catalog (user turn), last 8 chat turns, current song state + request]`. `stateText()` renders every track, pad and clip, with drum lanes as step strings grouped by bar and synth notes as `step:note/len`.
- **Tools** (`makeTools`): `write_drums`, `write_notes`, `set_track`, `delete_clips`, `set_song`, `offer_variations`. Each mutating tool snapshots the song first and rolls back on error, so a bad call changes nothing, and the error text goes back to Claude so it can correct itself. `offer_variations` dry-runs every spec before showing cards.
- **Undo:** the first mutating tool in a turn records `turn.before`; at the end that snapshot becomes one undo step, and the reply gets an "Undo these changes" button.
- **Errors** are mapped to plain copy in `aiErrorCopy`; permission or tool-unavailable errors disable the panel and point to grooves and variations instead.
- The full rules text is the `RULES` constant. It teaches the grid, the step format, where tech house bass sits (steps 2, 3, 6, 7, 10, 11, 14, 15), "only change what was asked", and "variations go through offer_variations, never written directly".

### 4.8 Export

`renderOffline()` builds an `Engine` on an `OfflineAudioContext` and schedules every step of the song (with swing), plus a 3 s tail. `encodeWav()` peak-normalizes to −0.26 dBFS only if needed and writes 16-bit PCM. `encodeMidi()` writes format 1 at 96 PPQ with one track per song track: synth notes are shifted +24 semitones so the sample's root lands on C3 (Ableton Simpler's original-pitch key), and drum pad *n* maps to MIDI 36 + *n* (Drum Rack's first pad). MIDI ignores swing. `makeZip()` writes an uncompressed zip with CRC32.

### 4.9 Persistence

localStorage key `thk-studio-song-v1`, written 600 ms after each change. Cloud songs live at `data/users/<viewerId>/<cloudId>` in the artifact db as `{name, savedAt, song}`. Neither exists outside claude.ai; replace both in Phase 5.

---

## 5. The sound engine

`build_kit.py` renders all 115 sounds from code: no samples. The order of renders and the three random seeds (7, then 2026, then 77) are what make the output bit-identical between runs, so **only ever append new sounds after the existing ones**. Inserting or reordering changes every later sound. `checksums.md5` lets you prove nothing moved.

| Category | Count | How they're made |
|---|---|---|
| Kicks | 30 | Sine (or triangle) with exponential pitch sweep, one or two stages, ending exactly on the tuned note; hold + exponential decay; optional click (band-passed noise + sine blip), noise layer, second partial, bit-crush on the transient, tanh drive, hard clip, low-pass |
| Bass | 30 | Saw/square/pulse/triangle rendered at 8× and decimated (anti-aliased), a TPT state-variable filter with envelope and drive, FM (2-op), wavefolding, ring mod, flanger, formant band-passes, detuned stacks |
| Claps | 8 | Band-passed noise with 3–4 retriggered bursts and a tail; some layered with a body tone, saturated or crushed |
| Snares | 6 | Two-tone body with pitch drop + high-passed noise, saturated |
| Hats, rides | 18 | TR-808 six-square-oscillator metal set, band-passed and high-passed, mixed with noise; rides add inharmonic sine partials |
| Shakers, rims, perc, toms | 23 | Shaped noise, sine pairs (rims, clave, woodblock), pitched membranes with pitch sweep (congas, bongos, toms), 808-style cowbell, FM blip, ring-mod metal |

Quality gate today (`verify_kit.py`): 24-bit/44.1 kHz, peak ≤ −1 dBFS, no DC or NaN, kick tails within 30 cents of their note, basses rooted on C2. Kicks currently measure within ±5 cents.

**Honest limits.** None of these sounds were listened to while being designed; they were checked numerically. The DSP is deliberately simple: a basic state-variable filter, one soft-clip stage, no layering of separately processed parts, no analog drift. Acoustic-style sounds (claps, shakers, congas) are the weakest. Phase 4 fixes this.

---

## 6. Decisions already made

Revisit these only with a concrete reason, and note why in the PR.

- Patterns are repeating clips; drum lanes use step strings; drum tracks have 8 pads; synth tracks play one sample chromatically.
- Bass samples are rooted on C2; kicks are tuned and carry their key in the id.
- Try / Keep cards are the single interaction for every suggestion.
- The assistant changes structured song data through tools and nothing else. It never renders audio into the song.
- One undo step per assistant turn; failed tool calls leave the song untouched.
- Web first. Mobile comes later through a wrapper, not a rewrite.
- Sound ids are permanent; renames go through the alias map.

---

## 7. Plan

Each phase ends with its acceptance criteria met and tests passing. Phases 2 and 4 matter most for "great"; don't shortcut them.

### Phase 0: Repository

- Monorepo (pnpm workspaces): `apps/web`, `packages/song` (data model and pattern logic, no DOM), `packages/audio` (engine), `apps/api` (Phase 3), `tools/sound-engine` (the Python in this folder, unchanged).
- TypeScript strict, ESLint, Prettier, Vitest, Playwright.
- CI: lint, unit tests, e2e tests, `verify_kit.py --md5`.
- **Done when:** CI is green on an empty app and the sound engine reproduces `checksums.md5`.

### Phase 1: Port to a real app, feature parity

- Vite + React + TypeScript. State in Zustand with an immutable song model.
- Replace JSON-snapshot undo with **command-based undo**: every edit is a command producing a patch (Immer patches work well). Assistant turns and Keep become one compound command each.
- `packages/song`: types for the model in 4.2, `writeClip`, `carve`, `tile`, `parseSteps`, `resolvePad`, grooves, variation specs, `migrate`. Pure functions, fully unit-tested. The server reuses this package in Phase 3.
- `packages/audio`: port `Engine`, the scheduler and offline render. One graph-builder function used for both live playback and export.
- Samples: serve from `/public` (later a CDN) as Opus or AAC for playback, WAV for export rendering; decode lazily per category with an in-memory cache. No more base64.
- **Done when:**
  - every feature in section 3 works except cloud save;
  - unit tests cover `carve`/`tile` edge cases (split mid-pattern, exact replace, merge), step parsing, pad resolution and MIDI encoding;
  - Playwright tests port every assertion in `prototype/tests/smoke_prototype.py`;
  - an offline render of the demo song matches the prototype's event list (same steps, sounds, pitches, velocities).

### Phase 2: Mix engine (the biggest lever on sounding "great")

Beginners don't need more plugins; they need a chain that's right by default and controls that speak their language.

**Per-track chain, fixed order:** high-pass → EQ (low shelf, mud cut, high shelf) → transient shaper → saturation (tanh/tape, oversampled) → compressor → sidechain duck → volume/pan → sends (reverb, tempo-synced delay). Write saturation and the transient shaper as AudioWorklet processors.

**Five macros per track, 0–100:**

| Macro | Moves |
|---|---|
| Punch | Transient attack gain (0 to +8 dB), compressor attack slower as it rises (more transient through) |
| Weight | Low shelf at the role's body frequency (kick 60 Hz, bass 80 Hz, snare/clap 200 Hz) up to +4 dB, with an automatic 250–400 Hz mud cut up to −3 dB |
| Grit | Saturation drive 0–18 dB with automatic output trim and a wet/dry mix |
| Space | Reverb and delay sends 0–40%; returns high-passed at 300 Hz and low-passed at 8 kHz so the low end stays dry |
| Pump | Sidechain depth 0 to −12 dB; release scaled to tempo (about one 8th note) |

**Role defaults** (applied when a sound is assigned, by category):

| Role | High-pass | Punch | Weight | Grit | Space | Pump |
|---|---|---|---|---|---|---|
| Kick | 25 Hz | 55 | 50 | 20 | 0 | n/a (sidechain source) |
| Bass | 30 Hz, mono below 150 Hz | 30 | 50 | 30 | 0 | 60 |
| Clap / snare | 150 Hz | 40 | 30 | 15 | 30 | 20 |
| Closed hat | 400 Hz | 30 | 0 | 10 | 15 | 20 |
| Open hat / ride | 300 Hz | 20 | 0 | 10 | 20 | 35 |
| Shaker / perc / rim / tom | 200 Hz | 30 | 20 | 10 | 25 | 25 |
| Stab / organ (synth used high) | 150 Hz | 20 | 20 | 20 | 35 | 50 |

**Master:** 20 Hz high-pass → glue compressor (2:1, 30 ms attack, auto release, about 2 dB of reduction) → soft clipper → true-peak limiter at −1 dBTP. Loudness target −8 LUFS integrated for "club", with a −14 LUFS "streaming" preview toggle. Show a simple meter.

**Guardrails:** loudness-matched A/B (Try compares at equal loudness, so louder never wins by default), low end summed to mono below 120 Hz, limiter always on, a per-track "reset to default".

**Done when:** the demo song with untouched defaults reaches −9 to −7 LUFS without clipping; each macro has a test proving it moves the parameters in the table; A/B of a variation is loudness-matched within 0.5 LU.

### Phase 3: Assistant v2 (server-side)

- `apps/api` calls the Claude API with tool use. Run the tool loop on the server against a copy of the song using `packages/song`. Return `{text, commands[], variations[]}`; the client applies `commands` as one undoable transaction and shows `variations` as cards.
- Port the six tools and the rules text as they are (4.7). Add mix tools: `set_macros(track, {punch, weight, grit, space, pump})` and `mix_check()`.
- **`mix_check`:** render offline, then measure integrated and short-term LUFS (K-weighted), true peak, kick/bass collision (bass energy at 40–120 Hz in the 80 ms after each kick versus between kicks), low-end mono correlation below 120 Hz, harshness (2–5 kHz energy against a genre target curve), and the loudness difference between drop and breakdown sections. Return findings as fixes; the client shows them as Try / Keep cards.
- Use prompt caching for the rules and catalog. Make the model configurable: a fast tier for direct edits, a stronger tier for "write me a track" and variations.
- Per-user rate limits and cost tracking from day one.
- **Done when:** every assistant test from the prototype passes against the API with recorded responses; mix_check flags a deliberately muddy test song and its suggested fix measurably reduces the kick/bass collision.

### Phase 4: Sound library pipeline (top-tier sounds from synthesis)

1. **Better DSP** in the Python engine: oversampled nonlinearities, a zero-delay-feedback ladder filter, layering (separately shaped sub, body and click for kicks), transient shaping, per-sound saturation and EQ, subtle analog drift.
2. **Parameter sweeps:** generate thousands of candidates per category.
3. **Automatic scoring** against reference sounds the product owner supplies: loudness, attack time, decay time (T60), spectral centroid and tilt, sub-energy ratio, and pitch stability for kicks. Keep the top few hundred per category.
4. **Curation UI:** a page that plays candidates in context (over a loop) with keep / reject / favourite, so a human with good ears makes the final cut.
5. Acoustic-style material (realistic claps, shakers, congas, vocal chops) is better licensed or recorded than synthesized; keep it on a separate track in the plan.

- New sounds get new ids and are appended; existing ids never change sound without a deliberate version bump.
- **Done when:** the library has at least 300 curated sounds and a blind A/B against a reference pack is at least competitive for kicks, bass and hats.

### Phase 5: Accounts, saving, sharing

Auth, songs in Postgres (one JSON document per song plus metadata), samples on object storage behind a CDN, share-by-link playback, a mobile-friendly layout. Migrate localStorage songs on first sign-in.

### Phase 6: The fun layer

Pads and steps light up on hit, kick-synced visuals, satisfying Try/Keep moments, fast first-run onboarding ("make a beat in 60 seconds"), and achievements that can later feed the learning hub.

---

## 8. Known gaps in the prototype

- One 8 MB file with globals and no build; sounds embedded as base64.
- Undo stores whole-song JSON snapshots.
- The assistant spends the viewer's own Claude usage through the artifact runtime; not shippable as-is.
- No automation, no velocity lane (only Shift-click soft hits), no per-track effects beyond filter, reverb and pan.
- MIDI export ignores swing; WAV export is 16-bit only.
- On touch screens, lanes and the piano roll capture drags, so scrolling the arrangement works only from track headers.
- The mix is one master compressor. This is the biggest gap between "works" and "sounds great".

## 9. Open questions for the product owner

1. Pricing and AI cost: free tier limits, and who pays for assistant usage.
2. Reference sounds and tracks to score the library against (Phase 4) and to tune the mix targets (Phase 2).
3. Platform priority after web: iOS, Android or desktop.
4. Product name ("THK Studio" is a placeholder).
