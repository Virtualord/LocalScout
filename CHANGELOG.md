# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-10-13

The first release. Everything below runs on a laptop with no API key, no Chrome
and no model: `pnpm dev` starts both servers and the bundled fixtures answer a
search.

### Added

**Discovery**

- SerpApi Google Maps search with an on-disk response cache, so a repeated
  search costs nothing.
- A recorded-fixtures mode covering three cities, so the whole pipeline is
  walkable offline and the tests never depend on a network.
- Normalised domain keys that reject social and directory hosts, so an audit
  never runs against a Facebook page.
- Phone normalisation through `libphonenumber-js/max`, with the type check that
  decides whether WhatsApp is actually available.
- Deduplication by `place_id` and by domain, with contacted domains never
  re-pitched.

**Audit**

- An SSRF guard: a scheme allowlist, per-address classification against a
  private-range table, IPv4-mapped IPv6 handling, and re-validation on every
  redirect hop.
- A single-visit fetcher with per-hop revalidation, size caps and timeouts.
- HTML checks for viewport, title, description, HTTPS and contact links.
- Lighthouse metrics where Chrome is available. Where it is not, the audit is
  labelled `stale` and the metrics are recorded as absent rather than as zero.
- A twelve-finding catalog held as data, with graded weight bands for the
  graded thresholds, feeding a 0-100 opportunity score.
- Local fixture sites that isolate one failure mode each.

**Drafting**

- Providers for Ollama, any OpenAI-compatible endpoint, and a fixture provider.
- A prompt builder that sends structured findings and nothing else. Raw scraped
  page text never reaches the model.
- A grounding validator that rejects unknown finding ids, invented numbers in
  any rendering, foreign URLs, banned phrases and over-length output.
- Deterministic fallback templates in English, Hinglish and Hindi, used
  whenever the model fails validation.
- An evaluation harness with a recorded result file.

**Application**

- A Mastra workflow, a CLI, and a cron scheduler for saved searches.
- A local Hono API bound to loopback, with SSE progress, a lead and draft API, a
  contact log, health checks and metrics.
- A SQLite store through Drizzle with a committed migration.
- A React web app: a token-driven design system, a canvas pixel map with a
  pointer spotlight and keyboard-navigable lead squares, and screens for
  search, leads, a lead modal, the dashboard, runs, settings and a full
  styleguide.

### Quality

- 725 fast tests and 5 slow ones, the slow suite exercising real Lighthouse
  against local fixtures with a real Chrome.
- A Playwright suite at 1440px and 390px covering every route, the keyboard
  path and the full search-to-draft flow, with axe-core on every route.
- ESLint 10 with flat config, strict TypeScript, Prettier, commitlint and
  lint-staged through husky.
- A secret scanner in the commit hook.

### Fixed during development

Recorded here because each was a defect that produced a wrong number or a
misleading screen, and each is now pinned by a test.

- A failed audit persisted nothing, so "never audited" and "audited but the
  site could not be reached" looked identical. A failed attempt now records a
  row carrying the reason, with no metrics and a null score.
- The single-lead endpoint returned the raw row, so a lead could show a score
  in the list and a blank in its own modal.
- The "newest" sort fell back to a random UUID tie-break when a run wrote
  several leads in the same millisecond, reshuffling the list on every reload.
- `getType()` from `libphonenumber-js` returns uppercase, which silently hid
  WhatsApp from every lead until a test caught it.
- pino's `info(msg, obj)` drops the object, so structured logs lost their data.
- Expanded `0:0:0:0:0:0:0:1` and every IPv6 private range bypassed the SSRF
  guard until the address classifier was rewritten.
- An empty resolver result failed open instead of closed.

[Unreleased]: ./compare/v0.1.0...HEAD
[0.1.0]: ./releases/tag/v0.1.0
