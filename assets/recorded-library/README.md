# Recorded library expansion

370 added library entries: **332 one-shots/phrases and 38 playable sampled instruments**, backed by 759 prepared WAV files. Instrument roots and dynamics are internal recordings, not extra preset counts. The existing 360 sounds remain, for 730 total.

The library includes electronic and acoustic drums, live hand percussion, twelve vocal phrases, FX, five grand/upright pianos, three sampled hardware FM keyboards, five organs, six mallet instruments, four plucked instruments, three guitars/strumstick, four basses, four string articulations and four brass articulations. Electronic drum files include synthesized/processed source material; they are not all microphone recordings or exact recreations of vintage hardware.

## Sources and permissions

Pinned source revisions and individual paths are in `import-plan.json`; prepared/source SHA-256 hashes are in `manifest.json`. Original permission documents are retained in `licenses/`.

- **Stargate Sample Pack** — Stargate contributors, including Fugue State Audio, Microlag, Karoryfer and Versilian. CC0. https://github.com/stargatedaw/stargate-sample-pack
- **VCSL** — Versilian Studios and contributors. CC0. https://github.com/sgossner/VCSL
- **VSCO 2 Community Edition** — Versilian Studios and contributors. CC0. https://github.com/sgossner/VSCO-2-CE
- **Black and Blue Basses** — D. Smolken / Karoryfer Samples. CC0. https://github.com/sfzinstruments/karoryfer.black-and-blue-basses
- **Meta Open Sound** — Meta Creative Audio. CC0. https://github.com/facebookincubator/Meta-open-sound
- **Oramics/Sampled** — selected CR-78, LM-2, MRK-2 and TR-505 collections, each explicitly marked Public Domain in its collection README. Original authors/source links are retained there. Other collections with unclear redistribution terms are excluded. https://github.com/oramics/sampled

The twelve vocal files are the Microlag vocal phrases from Stargate. They are one-shot phrases, with no claimed BPM or musical key. Use drum pads to keep their original playback speed. No phrase stretching or karaoke/full-song vocal stems are included. Names follow the source labels.

## Import and playback

Run `node tools/import-recorded-library.mjs` to download the exact pinned files and process them with the existing Python audio dependencies. Re-import checks the original hashes against the previous manifest. Builds only copy bundled files; there is no runtime CDN dependency. Run `node tools/kit-web.mjs --check` to verify generated metadata and all prepared audio checksums.

Processing downmixes to mono (with a fallback for antiphase stereo), resamples to 44.1 kHz, removes DC, trims silence, adds short boundary fades, peak-normalizes and stores 16-bit PCM. A shared gain preserves dynamics within each sampled instrument. Prepared one-shot duplicates are excluded by audio hash (none in this batch). Original source hashes are retained even when preparing a renamed or resampled asset.

Most samples retain up to four/six seconds; vocal phrases retain up to twelve seconds. Instrument mappings use nearby recorded pitches and soft/hard layers when available. Filename octave conventions are calibrated per instrument: most VCSL/VSCO recordings use C3 for MIDI 60, while Steinway, FM Piano and Concert Harp use scientific octaves; organ registrations and octave-transposing electric basses receive their appropriate offsets. The traditionally tuned Tanzanian mbira recordings are gently retuned to their labeled MIDI notes during preparation. Instruments without alternate takes do not pretend to have round robin variations. The existing two Shinyguitar instruments still alternate takes.

The C2 reference of each instrument supports the current sound editor. Copying an instrument creates an editable single-sample variation. Originals retain their complete pitch/dynamic mappings. Browsing uses metadata/waveforms only; audio is loaded when auditioned or used in a song.
