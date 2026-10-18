# Localscout

Find local businesses, audit their websites with real measurements, and draft
honest outreach that **you** review and send by hand.

Localscout never sends anything. There is no send code path. It finds businesses,
measures what is actually wrong with their site, writes a short message that cites
only those measurements, and hands it to you.

Everything runs on your machine.

---

## Quickstart

Three commands. No API keys, no Chrome, no Ollama, no network.

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:5173>.

This is **fixtures mode**: discovery reads 35 recorded SerpApi responses from
`fixtures/serpapi/`, auditing runs against local fixture sites, and drafting uses
canned JSON. Everything is exercised except the three external services.

Run a batch from the terminal instead:

```bash
pnpm cli "plumbers" Bhopal --limit 20
```

## How it works

```
Browser (React)  --HTTP/SSE-->  API (127.0.0.1:8787)
                                      |
                               Mastra workflow
  discover -> dedupe -> audit (x N) -> score -> draft (x N) -> persist
      |                       |                         |
  SerpApi              Lighthouse + HTTP          Ollama / compatible
  (disk-cached)        (SSRF-guarded)             (or fixtures)
                              |
                           SQLite
```

1. **Discover.** A business type and a city become a list of real Google Maps
   listings, with a place id, a rating, a phone number and a website.
2. **Dedupe.** Anything already found, or already contacted, is skipped. Two
   listings pointing at one site are one business, and you get pitched once.
3. **Audit.** Each site is fetched under an SSRF guard, checked for HTTPS, mobile
   readiness, title, description and contact links, and measured with Lighthouse.
4. **Score.** Twelve findings with explicit weights produce an opportunity score.
   A bad site on an active business scores high; on a dormant one, lower.
5. **Draft.** A local open-weight model writes a short WhatsApp message and an
   email in English, Hinglish or Hindi, citing at most three measured findings.
6. **Verify.** Every draft is checked back against the audit. An invented number,
   a banned phrase, or an unknown finding is rejected, the model is given one
   retry with the specific error, and failing that a deterministic template is
   used. Either way the message is sendable.

## Requirements

- Node.js 22.12 or newer
- pnpm 11

Optional, each configured in `.env`: Chrome for Lighthouse, Ollama for drafting,
a SerpApi key for live discovery. See [`.env.example`](.env.example).

## What it will not do

- **It will not send anything.** You copy, paste, and send. Then you log what
  happened.
- **It will not invent a number.** If Lighthouse could not run, the audit reports
  `stale` with no performance metrics, and no draft can quote a performance
  figure. A missing metric and a zero metric are different things.
- **It will not read scraped pages.** Anything fetched is treated as data, never
  as instructions. The model sees a small JSON object of measured values, not
  page text.
- **It will not pitch the same business twice**, by place id or by contacted
  domain.

## Ethics

- **Public business information only.** Name, category, address, rating, review
  count, and a phone number published on a public listing. Nothing else.
- **A contact email is only ever a `mailto:` published on the business's own
  website.** Nothing else may write that field.
- **No personal data is harvested.** There is no scraping of individuals, no
  enrichment from data brokers, no cross-referencing people.
- **Every message includes an opt-out line**, in all three languages.
- **A human sends every message.** No automation, no bulk sending, no scheduled
  outreach. Localscout's contribution stops at a draft you have read.
- **The user agent says what it is.** `LocalscoutAudit/<version>`. It does not
  impersonate a browser to slip past a site's bot rules, because then the
  measurement would not be one a business owner would recognise as legitimate.
- **One visit per site per audit.** Audits are bounded by `AUDIT_CONCURRENCY`.

## Limitations

Read these before trusting a number.

- **Lighthouse numbers are laboratory data.** One simulated mobile device, one
  network profile, one run. That is why the drafts say "in a mobile speed test I
  ran" and never "your customers experience". It is not a measurement of real
  visitors.
- **One site per listing.** If a listing has no website, or only a social page,
  it is reported as `NO_WEBSITE`. Localscout does not crawl a business's other
  properties, and it does not treat a Facebook page as a website to audit.
- **Local by default, deployable by choice.** There is no account, no cloud
  database, and no telemetry. The trade-off is that it does not sync between
  machines. An opt-in single-service deploy ([docs/DEPLOY.md](docs/DEPLOY.md),
  [ADR-0004](docs/adr/0004-cloud-deploy-carve-out.md)) covers the always-on-URL
  case, and says exactly what moves where.
- **Chrome is optional.** Without it, audits run their HTTP and HTML checks only
  and report `stale`. That is most of the value; performance numbers are not.
- **A small local model will sometimes drift.** Measured on `gemma3:4b`:
  67% of drafts grounded on the first try, 22% after one retry, 11% falling back
  to a template. The fallback is why every draft is always sendable. See
  [`docs/WRITEUP_NOTES.md`](docs/WRITEUP_NOTES.md).
- **Fixtures are synthetic.** The 35 recorded listings were generated for
  testing. The businesses, place ids and phone numbers are invented.
- **Scores are a hypothesis.** The finding weights encode an opinion about what
  makes a good lead. They are table-driven so the opinion is visible and
  arguable, and the first-user log is the place to argue it with evidence.

## Documentation

| Document                                             | What is in it                                               |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)         | How the pieces fit, and the three contracts that shape them |
| [docs/MANUAL_STEPS.md](docs/MANUAL_STEPS.md)         | The nine things only a person can do, with exact commands   |
| [docs/DEPLOY.md](docs/DEPLOY.md)                     | Running the same app on a container host, and what it costs |
| [docs/WRITEUP_NOTES.md](docs/WRITEUP_NOTES.md)       | Real measurements, and where they are thin                  |
| [docs/DESIGN_REFERENCE.md](docs/DESIGN_REFERENCE.md) | Which design effects are observed and which are inferred    |
| [docs/adr/](docs/adr/)                               | Decisions with a tradeoff worth remembering                 |
| [CONTRIBUTING.md](CONTRIBUTING.md)                   | Branching, commit rules, the quality gate                   |

## Development

```bash
pnpm dev            # API and web app
pnpm test           # unit, integration, component, API
pnpm test:slow      # real Lighthouse against local fixtures; needs Chrome
pnpm e2e            # Playwright at 1440px and 390px, with axe on every route
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # the gate
pnpm eval           # draft quality across EVAL_MODELS
```

Both `pnpm test:slow` and `pnpm e2e` boot against a throwaway database and need
no key. `test:slow` skips with a stated reason when Chrome is absent rather than
failing, because a missing browser is a supported setup, not a defect.

## Stack

TypeScript throughout. Mastra for the workflow, SerpApi for discovery, Lighthouse
and deterministic HTTP checks for the audit, Drizzle and SQLite for storage, Hono
for the API, React and Vite for the interface, Vitest and Playwright for tests.

Reasoning for each choice, and what was deliberately left out, is in
[ADR-0001](docs/adr/0001-stack-choices.md).

## License

MIT. See [LICENSE](LICENSE).
