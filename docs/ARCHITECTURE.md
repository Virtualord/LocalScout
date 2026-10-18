# Architecture

## The shape of the thing

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

Everything runs on one machine. The server binds to `127.0.0.1`, the database is
a file, and the only network calls are the ones the user explicitly configured.

A single opt-in deploy path runs this same process on a container host, with
the interface served by the API itself and a token in front of every route; the
default is unchanged. See [DEPLOY.md](DEPLOY.md) and
[ADR-0004](adr/0004-cloud-deploy-carve-out.md).

## Repository layout

```
localscout/
  apps/
    api/        src/{main,app,runtime,cli,cli-args}.ts
                src/routes/{runs,leads,health}.ts
                src/mastra/{workflows,steps}
    web/        src/{main.tsx, app/, components/, design/, features/, lib/}
  packages/
    core/       src/{config,logger,result,db,discovery,audit,draft,scoring,
                    phone,pipeline,eval}
  eval/         run.ts
  fixtures/     serpapi/*.json
  docs/         ARCHITECTURE.md, DESIGN_REFERENCE.md, MANUAL_STEPS.md,
                DEPLOY.md, WRITEUP_NOTES.md, adr/
  Dockerfile    the deployable image (see docs/DEPLOY.md)
  render.yaml   the reference platform blueprint
```

## The one idea that shapes everything

**Evidence before words.** The audit produces structured, deterministic facts.
The model turns those facts into prose. Every draft is then checked back against
those same facts, and anything it cannot be shown to have measured is rejected.

That is why the layering looks the way it does:

```
discovery  -> what businesses exist          (SerpApi or recorded)
audit      -> measured facts about a site     (HTTP + HTML + Lighthouse)
scoring    -> findings with weights           (pure, table-driven)
draft      -> prose citing those findings     (model, then validated)
grounding  -> reject anything unsupported     (pure, heavily tested)
```

The model never sees a scraped page. It sees a small JSON object of measured
values. A scraped page is untrusted content, and pasting it into a prompt is how
a business owner's site ends up instructing the model to write something else.

## Three contracts worth knowing

### `SourceResult<T>`

Every external call returns one of three shapes:

```ts
{ status: 'ok',          value: T }
{ status: 'stale',       value: T, error }   // partial but real
{ status: 'unavailable', error }             // nothing measured
```

The distinction that matters: **a missing metric and a zero metric are different
things.** When Lighthouse fails, `metrics` has no keys at all, and the drafting
layer cannot claim a number. If it could, every failed audit would silently
become "your site scored 0", which is both wrong and dishonest to the business.

`sourceResult()` enforces the pairing in the type, so an `ok` with no value or a
`stale` with no explanation throws at the point of the mistake rather than
surfacing later as a confusing null.

### The findings catalog

Twelve findings, each with an id, a weight, and a plain-English label, held as
data in `packages/core/src/scoring/findings.ts`.

Keeping it as data means a scoring change is a reviewable diff of numbers rather
than a refactor, and every finding carries the measured value and threshold it
fired on. Those evidence values are exactly what the grounding validator
allowlists, which is why a draft cannot quote a figure nothing measured.

### The grounding validator

`packages/core/src/draft/grounding.ts`, pure and heavily tested. It rejects:

1. Citations of findings the audit did not produce.
2. Any number not present in the audit's own evidence, in any rendering
   (`6100`, `6.1`, `6,100`).
3. URLs that are neither the lead's own site nor the sender's portfolio.
4. Banned phrases, and over-length messages.

## Layering

**`packages/core`** holds every behaviour and is where the tests are. It has no
knowledge of HTTP or of Mastra.

**`apps/api/src/mastra`** is a thin shell. `createStep` and `createWorkflow`
supply typed input/output schemas and a run handle; `execute` delegates to
`runPipeline` in core. If Mastra changes shape, only that directory changes.

**`apps/api/src/routes`** is validation, delegation, and response shaping.

**`apps/web`** renders. It never computes a score or a finding.

The practical test of this layering: every business rule has a unit test that
runs with no server, no database file, and no network.

## Concurrency

Two different strategies, on purpose:

- **Audits run concurrently**, bounded by `AUDIT_CONCURRENCY`. They are I/O
  bound across different hosts, so a 50-lead run would otherwise be minutes of
  sequential waiting.
- **Drafting runs sequentially.** A local model serves one request well at a
  time; parallel calls queue inside the model and make every one of them slower,
  not the run shorter.

## Safety

| Concern            | How it is handled                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| SSRF               | Scheme allowlist, DNS resolved and every address classified, redirects re-checked, size cap, honest user agent |
| Secrets            | Never returned by the API, never logged (redacted), never committed (pre-commit hook)                          |
| Privacy            | Only public business data; a contact email comes only from a `mailto:` on the business's own site              |
| Sending            | There is no send code path                                                                                     |
| Duplicate outreach | `place_id` unique; contacted domains are filtered before auditing                                              |
| Prompt injection   | Scraped text never reaches the model; only structured findings do                                              |

## Database

SQLite through Drizzle, one file, migrations committed. Foreign keys on, WAL on,
`busy_timeout` set. Timestamps are integer milliseconds: `unixepoch()` alone
truncates to whole seconds, which made "the newest audit" ambiguous whenever two
audits landed in the same second.

Ordering ties break on `rowid`, because fixture-speed runs genuinely do write two
rows inside one millisecond.

## Testing

| Level         | Tool                     | Count    | What it proves                                                     |
| ------------- | ------------------------ | -------- | ------------------------------------------------------------------ |
| Unit          | Vitest                   | 500+     | Scoring, grounding, SSRF, layout, templates, parsing               |
| Integration   | Vitest                   | included | Audit against local fixture sites; full pipeline against a temp DB |
| Component     | Vitest + Testing Library | 32       | Focus trapping, keyboard, accordion, reduced motion                |
| API           | Vitest via `app.fetch`   | 45       | Routing, validation, response shapes, security headers             |
| e2e           | Playwright               | phase 10 | The user journeys in a real browser                                |
| Accessibility | axe-core                 | phase 10 | Every route                                                        |

Slow tests (`pnpm test:slow`) need Chrome or a real model and are excluded from
CI, which has neither.
