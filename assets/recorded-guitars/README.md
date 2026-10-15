# Recorded guitars

Real archtop guitar performed and sampled by **D. Smolken / Karoryfer Samples** in Shinyguitar. The acoustic instrument uses the microphone recordings; the clean electric instrument uses the magnetic pickup recordings. These are separate captures of the same archtop guitar, rather than a dreadnought acoustic or an amplified/distorted electric.

- Original project: https://github.com/sfzinstruments/karoryfer.shinyguitar
- Upstream commit: `57243cca85277dbcc120ce17c6178032f93c80f3`
- Author's description: https://shop.karoryfer.com/pages/free-shinyguitar
- License: **CC0 1.0**, preserved in `LICENSE.txt` (redistribution and commercial use allowed).

THK includes seven recorded roots (MIDI 37, 42, 48, 54, 60, 66, 72), two dynamic layers (original layers 2 and 4) and two alternating takes for each root/layer, for each capture. The sampler chooses the nearest root, changes timbre with note velocity and alternates takes deterministically. The supplied notes naturally cover roughly C2–C5; pitches outside that range are extrapolated.

Import processing removes DC offset, trims onset silence leaving 3 ms before the pick, keeps up to five seconds of natural decay, fades boundaries and converts to mono 16-bit/44.1 kHz. One gain is applied across each instrument to preserve differences between dynamics and takes. A C2 reference derived from Db2 supports the existing sample editor; copying into that editor creates a single-sample variation.

`manifest.json` records each source path, original SHA-256 and prepared SHA-256. Re-import explicitly with `node tools/import-guitars.mjs`. Normal builds use only these bundled files. `node tools/kit-web.mjs --check` checks metadata and all prepared audio checksums.
