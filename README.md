# Localscout — local-first lead research and honest outreach drafting.

> Localscout finds local businesses, audits their websites with real measurements,
> and drafts outreach you review and send by hand. It never sends anything.

## Status

Early build. See [docs/MANUAL_STEPS.md](docs/MANUAL_STEPS.md) for what still needs
a human, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

## Quickstart

Three commands, no API keys, no Chrome, no Ollama required — this runs in
fixtures mode:

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:5173>.

## Requirements

- Node.js 22.12 or newer
- pnpm 11

Everything else (Chrome for Lighthouse, Ollama for drafting, a SerpApi key for
live discovery) is optional and configured through `.env`. See
[`.env.example`](.env.example).

## License

MIT — see [LICENSE](LICENSE).
