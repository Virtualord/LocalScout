# ADR-0001: Stack choices and what was left out

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Localscout maintainer

## Context

Localscout is a local-first tool for one person: a freelance web developer who
needs clients. It finds local businesses, audits their websites with real
measurements, and drafts outreach that a human reviews and sends by hand.

Four constraints shape almost every choice:

1. **Local only.** It must run entirely on the user's machine, with no cloud
   account, no remote database, and no telemetry. Server binds to `127.0.0.1`.
2. **Works with nothing installed.** `pnpm dev` must produce a full, useful run
   with no API keys, no Chrome, and no Ollama. That forces every external
   dependency behind an interface with a fixtures implementation.
3. **Near-zero marginal cost.** At a few dozen leads per search, a billed model
   per draft changes the economics, and sending business data to a hosted API
   has a privacy cost.
4. **Evidence before words.** A draft may only assert what a tool measured, so
   the audit must produce structured, deterministic facts that a validator can
   check a language model against.

Volume is low (tens of leads per run), the user is one person, and the data is
not shared with anyone.

## Decision

| Concern       | Choice                                                           | Why                                                        |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Language      | TypeScript everywhere, strict                                    | One language, shared types end to end                      |
| Monorepo      | pnpm workspaces                                                  | Small, fast, one lockfile                                  |
| Orchestration | Mastra (`@mastra/core`) workflows                                | Typed steps with zod input/output and observable run state |
| Discovery     | SerpApi Google Maps engine                                       | Real listings with stable `place_id`s, disk-cached         |
| Audit         | Lighthouse Node API plus deterministic HTTP/HTML checks          | Measured facts, open source                                |
| Drafting      | Gemma via Ollama or any OpenAI-compatible endpoint               | Open weights, local, no per-token bill                     |
| Database      | SQLite via `better-sqlite3` and Drizzle ORM                      | Zero setup, single file, migrations are code               |
| API           | Hono on `@hono/node-server`, SSE for progress                    | Small, typed, first-class streaming                        |
| Web           | Vite, React, React Router, TanStack Query, Radix UI, Tailwind v4 | Accessible primitives, tokens as CSS variables             |
| Tests         | Vitest, Playwright, axe-core                                     | Unit, e2e, accessibility                                   |
| Quality       | ESLint, Prettier, husky, lint-staged, commitlint, GitHub Actions | Enforced, not aspirational                                 |

Step logic lives in pure, tested functions in `packages/core`; the Mastra
workflow is a thin shell over them. A framework quirk must never trap the logic.

### Deliberately not used

- **MongoDB Atlas.** No managed database, and no network dependency for a tool
  whose selling point is local operation. Deduplication here is a keyed lookup
  on `place_id` and `domain_key`, which SQLite answers with a unique index.
- **DigitalOcean GPU / a hosted vector database.** Billed GPU inference is the
  wrong shape for tens of drafts on a laptop that can already run a 4B model.
  Embedding the leads and doing similarity search would add cost, latency, and a
  second datastore to answer a question the audit already answers with numbers.
- **A hosted LLM as the default.** Provider, base URL, and model are
  env-configurable, but the supported default is a local open-weight model.
- **Automated sending of any kind.** There is no send code path. A human
  reviews, copies, and sends.

## Consequences

### Positive

- A fresh clone runs end to end with no keys and no setup.
- No data leaves the machine unless the user opts into live discovery.
- Draft cost is zero at this volume, so running a search twice is free.
- Every UI claim can be traced to a stored measurement.

### Negative

- Fixture quality becomes a real cost: recorded responses and local fixture
  sites must be maintained, and they can drift from live API shape.
- Local inference is slower than a hosted API, so drafting is sequential by
  design.
- Lighthouse needs Chrome, which many machines lack; those runs degrade to
  `stale` rather than fabricating metrics.
- A single user means single-writer assumptions are fine now, but the schema
  would need real concurrency handling before any team use.

### Neutral

- SQLite is a local file, so "deploy" is not a concept in this project.

## Verification

Current official documentation was read before committing to each API:

- Mastra `createWorkflow` / `createStep` / `createRun().start()` and zod schemas:
  <https://mastra-ai.mastra.ai/docs/workflows/overview>
- Lighthouse Node API with `chrome-launcher`, reading `runnerResult.lhr`:
  <https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/docs/readme.md>
- SerpApi Google Maps engine response shape (`local_results[]` with
  `place_id`, `gps_coordinates`, `rating`, `reviews`, `links`):
  <https://serpapi.com/google-maps-api>
- Drizzle ORM SQLite setup and migrations:
  <https://orm.drizzle.team/docs/get-started-sqlite-new>
- pnpm 11 workspace settings: <https://pnpm.io/settings>

### Deviations found while verifying

1. **TypeScript pinned to 6.0.3, not the latest 7.0.2.** TypeScript 7 is the
   native port. `typescript-eslint@8.71.2` declares
   `peerDependencies: { typescript: ">=4.8.4 <6.1.0" }`, so linting and the
   toolchain would break on 7.x. Pinned to the newest version inside the
   supported range and noted here; revisit when typescript-eslint supports 7.
2. **`pnpm-workspace.yaml` is the settings file, not `.npmrc`.** pnpm 11 reads
   settings from the workspace manifest using camelCase keys, and
   `onlyBuiltDependencies` was replaced by the `allowBuilds` map.
3. **ESLint 10 is flat-config only.** The repository uses `eslint.config.js`
   (ESM, since the root package is `type: module`). No `.eslintrc` file exists.
4. **Per-package dev dependency versions are independent of the main package.**
   `@eslint/js` is at 10.0.1 while `eslint` is at 10.12.0; they are pinned
   separately.
