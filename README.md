# thk-studio

Personal house-music studio with editable patterns, sound design and an AI co-producer.

The library has **730 sounds**, including a [370-entry recorded expansion](assets/recorded-library/README.md): electronic/live drums, percussion, vocal phrases, pianos, electric keys, organs, basses, guitars, mallets, strings, brass and FX. Search the whole library or filter by recorded/synth sounds and sample pack. Browsing only uses metadata; audio loads on preview/use. Sources are bundled locally under CC0/public-domain permissions with pinned versions, original licenses and checksums.

The original real microphone-recorded acoustic guitar and clean electric pickup recordings from [Karoryfer Shinyguitar](https://shop.karoryfer.com/pages/free-shinyguitar) remain available. Sampled instruments use nearby recorded pitches and dynamic layers; Shinyguitar also alternates takes. Source credits and import details are in [the guitar assets](assets/recorded-guitars/README.md). Vocal phrases keep their original timing on drum pads; they do not automatically stretch to BPM. WAV export retains long sample tails.

Run `corepack pnpm dev`, then open http://localhost:5190. The assistant menu offers **Auto**, **Claude** and **ChatGPT**. Auto uses Claude first, then ChatGPT if Claude has a connection, sign-in or usage-limit failure.

For ChatGPT, install the Codex CLI and run `codex login` with your ChatGPT account. An existing ChatGPT sign-in is reused; no OpenAI API key is needed. Click Reconnect in the assistant after signing in. If the CLI is not on PATH, set `THK_CODEX_BIN` to its absolute path in `.env.local` and restart the studio. The model is discovered from the account; `THK_CHATGPT_MODEL` can select a specific available model.

Claude continues to use your local Claude sign-in or `ANTHROPIC_API_KEY` as before. `.env.example` lists optional settings. These account integrations are for personal local use.

Product priorities and engineering direction: [product roadmap](docs/product-roadmap.md). Technical background: [handoff](HANDOFF.md) and [decisions](docs/decisions.md).
