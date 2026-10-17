# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

An audit pass over the whole codebase, and the two user-visible things it turned
up: a run can be stopped, and the map's spotlight — which had never once drawn —
now works.

### Added

- **Stop a search.** `POST /api/runs/:id/cancel` and a button on the runs screen.
  Cancellation is cooperative: the audit already in flight finishes and stays on
  the record, and nothing after it starts. A lead the run stopped before reaching
  keeps its `discovered` status — it is neither audited nor failed, because
  nothing about it was tried. The refusal a second search gets while one is
  running has always told the user to stop the first one from the runs screen, and
  until now there was no control there to do it with.
- **Reaping.** A run whose process died stayed `running` forever, which refused
  every later search until the row was edited by hand. The API now marks those
  runs failed at boot and at shutdown, with the reason written into the row.

### Changed

- The map grid is wider (96×28 on desktop, 40×24 on mobile), cell size is derived
  from the grid so squares stay square at any width, and the map runs the full
  width of the page.
- The home hero is centred.
- A lead card with no measurement says "not measured" instead of a bare dash,
  which read as a zero.
- The single-lead response no longer carries a `counts` block that no screen
  read.
- `boot()` throws a `ConfigError` instead of printing it and calling
  `process.exit`, so each caller decides. The API renders it against the port it
  tried to bind, the CLI prints the same sentence and exits 1 rather than
  surfacing raw zod internals as a stack trace, and a test asserts the wording
  without a process dying.

### Fixed

- **The spotlight never appeared.** Its position was copied into refs by one
  effect and read by another whose dependencies were only the layout and the
  size, so the land was painted once and never again. The draw now depends on the
  light as two numbers — and resizes the canvas only when the size actually
  changed, which it had to, or the fix would have reallocated a full-screen
  bitmap on every frame.
- **The map's projection box pinned nothing.** It was captured by a `useState`
  initializer that ran before the first search answered, so it pinned "no box"
  for the life of the screen and every later batch of leads re-derived one, moving
  every square already on the map. A lead far outside the pinned box also
  projected thousands of cells off-grid, where the placement search could not
  reach it, and was dropped from the map in silence; it now lands at the nearest
  edge.
- **The draft language could not be picked.** The switcher rendered only when a
  draft already existed, so with nothing written there was no way to ask for
  Hindi or Hinglish at all — and the request hardcoded English even though the
  API had always accepted a language.
- **The lead list was written out twice**, and the copy under the map had lost
  the "run another search" card, so the card came and went with the view toggle.
- **A request body was capped by its `content-length` header alone.** A chunked
  body declaring no length was unbounded. The cap now counts bytes as they
  arrive.
- **Workflow dependencies were module-level singletons.** A run's cancellation
  signal, event sink and logger were overwritten by whichever run started last in
  the same process. They are keyed by run id.
- **Listing leads loaded every row to show one page of them.** Filtering, sorting
  and paging moved into SQL, and the total is counted with the same conditions
  the page used, so a filtered list and its count can no longer disagree.
- **The audit body was buffered whole before its cap was applied**, so the cap
  bounded what was kept rather than what was read. It streams now.
- **SSE progress buffers were kept for every run the process had ever served.**
  A finished run's buffer is dropped after five minutes, and at most twenty are
  held.
- The directory-host exclusion list carried duplicates and one unreachable entry:
  `google.com/urls` spells a path, and a hostname never contains a slash, so it
  could never match. The redundant subdomain entries went with it — a subdomain
  already matches through its parent host.
- **Live discovery never worked, whatever key you had.** The SerpApi request sent
  the city in `ll`, which is the _coordinates_ parameter and must read
  `@23.2599,77.4126,12z`; SerpApi answered every request with "Invalid format of
  the `ll` parameter". A place name belongs in `location` paired with `z`, and
  that is what is sent now — verified against the live API, returning real
  businesses. The test asserted the broken value, which is how it survived. The
  error message no longer blames the API key for a malformed request either: it
  reports what SerpApi said in the body, which is the sentence that actually
  explains the failure.
- **Nothing read `.env`.** The README, the settings screen, the health check's own
  advice and the manual all say to put the key there, and no code opened the
  file — so following the instructions exactly produced an app that reported no
  key, with nothing in the logs to say why. It is read at boot now, from the
  repository root whichever directory the command ran from, without overriding a
  variable already in the environment.
- The `ssrf.ts` header claimed the resolved address was pinned for the request.
  It is checked, not pinned; the comments now say so and ADR-0002 records the
  residual.
- **Clicking the search field drew a second box inside it.** The focus ring was
  an outline on the `<input>`, which sits inside the field's padding, so the ring
  appeared as a rectangle floating in the middle of the field with the
  placeholder text crossing it — a misaligned border rather than focus. The ring
  is drawn on the field itself now. The `outline-none` utility that was supposed
  to suppress the inner ring could not: Tailwind's utilities are in a cascade
  layer and unlayered CSS beats them whatever the specificity, so the opt-out is
  stated in the stylesheet, and the rule that claims to do it says why.
- **The settings rows ran their label into their value.** On a phone the two were
  forced onto one line and `DISCOVERY` sat against the start of the value,
  touching it. Comparison rows are a description list now — a screen-reader pause
  and a line break in copied text, where two spans in a div gave neither and the
  pair read and copied as `DiscoveryFixtures` — stacked below the `sm`
  breakpoint, and inset from the card edge, which they were previously sitting
  flush against.

### Quality

- 892 fast tests and 5 slow ones. New coverage where it was thinnest: the search
  flow on the home screen, the leads screen in both views, the runs screen's stop
  control, the lead modal's language switcher, the map (repaints, the pinned
  projection box, and the spotlight's entry, easing and fade-out), the design
  primitives' focus ring — asserted in the browser as a computed style, since
  jsdom has no cascade to test — and `.env` loading, including that a shell
  variable still wins over the file.

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

- 775 fast tests and 5 slow ones, the slow suite exercising real Lighthouse
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
- Two shipped templates ran sentences together: the English WhatsApp draft
  produced "speed fixes.If it is useful", and the Hindi draft doubled its
  terminator into "।.". Both were found by a clean-clone smoke test rather
  than by review, and both are now pinned by a rule that covers every template
  in every language.

[Unreleased]: ./compare/v0.1.0...HEAD
[0.1.0]: ./releases/tag/v0.1.0
