# THK Studio: from first beat to finished house track

The product goal is a beginner making a professional house track through decisions they can hear: describe, audition, compare, keep, refine. The current editable song model, shared music tools and one-step undo are the foundation.

## 1. Reliable personal AI — implemented

The assistant has Auto, Claude and ChatGPT choices. ChatGPT uses the local Codex app-server and the owner's existing ChatGPT sign-in; it does not require an OpenAI API key. Auto tries Claude first and retries operational failures with ChatGPT. Both providers use the existing pattern, variation and sound-design tools. A provider attempt edits a private copy, so a failed attempt cannot duplicate edits in the real song. Replies name the provider that handled them.

This is a local personal integration. A future hosted product needs its own account, credential and billing design. ChatGPT subscription usage remains subject to the account's available models and limits. This is not a connection to the user's ChatGPT web conversation history.

## 2. A guided first session — recommended next

Create a simple Make a beat view alongside the existing detailed editor. Start with a style and energy choice, tempo, and a large Make my first beat action. Show six understandable parts: Kick, Drums, Bass, Chords, Hook and FX. Each part gets preview, mute, replace sound and three variations. Let the user open notes when they want finer control.

The assistant should know the selected part and section. Offer short actions such as Add bass, More bounce, Simplify and Finish this section instead of requiring a beginner to invent prompts or type bar numbers. Keep one conversation with Beat and Sound contexts sharing the same song. Show each proposed change's target and let the user compare before keeping it.

Acceptance: a first-time user can create, change and export an eight-bar idea without editing a MIDI note or learning synthesis terminology.

## 3. Professional mix defaults — the largest audio-quality gap

Implement the mix engine already specified in HANDOFF Phase 2: role-based EQ and dynamics, tempo-aware kick/bass ducking, controlled effect returns and master peak protection. Expose Punch, Weight, Grit, Space and Pump. Add loudness-matched comparisons so users judge tone and groove fairly.

Give the AI measured mix information through mix_check and set_macros. Present findings in plain language with Try/Keep fixes: Bass is masking the kick; try this balance. Render offline to verify peaks, loudness, timing and low-end collisions; use human listening sessions to judge musical quality.

Acceptance: untouched defaults produce a balanced demo without clipping; comparisons are loudness-matched; a suggested mix fix measurably addresses the issue it identifies.

## 4. Turn loops into songs

Add named Intro, Groove, Break, Build, Drop and Outro sections; energy and length controls; duplicate and vary a section; transitions and fills; and automation lanes for filter, effects and volume. Offer three arrangement directions with previews. Add version snapshots so users can explore multiple song directions.

Acceptance: a user can turn their eight-bar idea into a complete arrangement, audition the transitions and undo the whole AI arrangement as one action.

## 5. A library worth exploring

Grow from the current 730 built-in sounds through curated batches. The recorded expansion adds 298 drum/percussion entries, 12 vocal phrases, 22 FX/transitions and 38 playable instruments. Global text search, source/pack filters and on-demand audio loading are implemented. Continue with favorites, recent sounds, related sounds, preview-in-song and more singer-performed vocal hooks with clear redistribution permission. Add tags such as warm, dark, punchy, dry and bright. Keep sound ids and saved projects stable. Recorded instruments use nearby pitches and dynamic layers; Shinyguitar also alternates takes. Human audition in real loops remains the musical-quality gate.

At thousands of sounds, add a catalog search tool that returns a small set of relevant candidates to the AI. The current prompt embeds the catalog; sending the entire expanded library on every turn would increase latency and make selection less reliable. Keep playback loading lazy and limit the decoded-audio cache as the library grows.

Extend sound design with playable previews, three sound alternatives, automatic level matching, simple character controls and save-to-library. The current renderer turns a patch into a fixed sample; evolving pads, expressive synths and tempo-following effects will eventually need more capable instruments and automation. Vocals and realistic acoustic material need a separate recording or licensed-content workflow.

Acceptance: users can reliably find several distinct sounds that fit the same part, compare them in context, and recall their own sounds in another song. Preset count alone is not the quality gate.

## 6. Finish and return

Add a project browser with named saves, recoverable versions and backup/import. Later add cloud accounts, sharing and stems export alongside the existing WAV/MIDI export. A simple Finish view should guide arrangement completeness, mix checks and export.

Keep a shared Song model and validated tool layer under every view and AI provider. Put musical intent and sound search in a reusable layer rather than duplicating them in each provider. Add task-based assistant evaluations for complete beats, useful variations, sound design, preserving unrequested parts, undo and recovery. Keep advanced editing available as users grow.

Recommended delivery order after the integration: guided beat view, mix defaults, arrangement builder, sound discovery and curated expansion, then project management and sharing. Develop audio quality alongside the beginner experience.
