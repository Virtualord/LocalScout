# ADR-0004: A cloud deploy as an explicit carve-out

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Localscout maintainer

## Context

ADR-0001 states the project runs on the user's machine, and notes that SQLite
being a local file means "deploy" is not a concept in it. That has been true
while the app runs under `pnpm dev`. The request that forced this ADR: run the
same app on a container platform, reachable at a personal URL — so the database
lives somewhere always-on and a search can be started from a phone.

The constraints do not move: one user, no accounts, no telemetry, local
operation as the default. The shape of the code does, though: the API binds
`127.0.0.1`, has no authentication, keeps runs in the process that started
them, streams progress over SSE, stores everything in one SQLite file, and
needs a real Chrome for Lighthouse.

## Decision

Support deployment as an **opt-in carve-out**, encoded rather than documented
away:

1. **One Docker service serves everything.** The API serves the built
   interface (`SERVE_WEB`), so the browser sees one origin: no CORS between
   halves, no cross-origin negotiation for the SSE stream, and one sign-in
   covers the UI and the API.
2. **Loopback stays the default, and beyond it a token is mandatory.** The
   config loader refuses a non-loopback `HOST` without `AUTH_TOKEN`, and a
   token shorter than 16 characters is refused everywhere. The token gates
   every route except `/api/health`.
3. **One instance, a disk for persistence.** Runs live in their process and
   SQLite is a single writer, so scaling is refused rather than pretended; a
   disk pins the service to one instance anyway. The blueprint defaults to
   Render's free plan — no payment method — where the database lives on the
   container's filesystem and resets with the instance. The persistent shape
   (paid plan, disk) is one comment away in the same file.
4. **The image is the deployable unit** (`Dockerfile`), with Chromium so audits
   measure rather than degrade to `stale`, and Render gets a blueprint
   (`render.yaml`) as the reference platform. `docs/DEPLOY.md` is the
   walkthrough.

## Alternatives considered

- **Serverless (Vercel functions and the like).** Not a configuration problem
  but a shape problem: no persistent filesystem for SQLite, no Chrome, and
  runs are minutes-long in-process work with an SSE stream attached. "Deploy
  the interface to Vercel statically" is possible, but the API still needs a
  container host with a disk, so the split adds CORS and SSE-auth surface to
  buy nothing for a single-user tool. `docs/DEPLOY.md` says this plainly.
- **Public without a token.** Anyone with the URL could spend the SerpApi
  quota and read the lead database. Refused by the config loader rather than
  left to a warning.
- **A hosted database (Postgres, Turso) to fit serverless.** Would move the
  data somewhere the projection never intended, for no gain at one user.
- **Multi-instance behind a load balancer.** Splits runs from their process
  and SQLite writes; pretending otherwise would create the bug, not fix it.

## Consequences

### Positive

- A deployment is a configuration choice, not a fork: same code, same tests,
  same fixtures-mode quickstart.
- The local default remains three commands with no keys.
- The token rule makes the unsafe binding impossible to reach by accident.

### Negative

- The deployed instance entrusts business data and the SerpApi key to a
  platform; the token is a shared secret, not accounts. Losing it means
  anything on that URL is readable.
- Ollama cannot realistically run on a small container host, so hosted
  drafting means a billed OpenAI-compatible endpoint. The fixture provider
  remains the fallback and stays honest about it.
- `/api/health` is intentionally public — a platform health checker cannot
  sign in — so key-presence booleans and the database path are visible to
  anyone with the URL.
- Free is a trial shape: no disk, so the database resets on every deploy,
  restart and idle spin-down, and no shell, so it cannot be retrieved before
  it does. The blueprint says so where it matters rather than letting someone
  lose leads quietly.
- Lighthouse is CPU-bound: slow on a 0.5 CPU install, impractical on free's
  0.1. The blueprint comments say which plan is for what.

### Neutral

- The README's "local only, by design" now reads "local by default, deployable
  by choice", with the deploy path documented and ADR-linked.
- `.env` remains the local configuration file; a deployment uses the
  platform's environment variables, and the image excludes `.env` so the two
  cannot be confused.

## Verification

- The exact runtime path was smoke-tested locally, before any platform was
  involved: web build, `HOST=0.0.0.0`, `SERVE_WEB=true`, a generated token.
  `curl` confirmed 401 with a `Basic` challenge anonymously, 200 for both
  token forms, the SPA fallback returning the document for `/leads`, 404 for
  a missing image rather than the document, `/api/health` open, and the
  hashed asset served with `immutable`.
- The config rules and the middleware have unit and integration tests (the
  fast suite: 912 tests at the time of writing).
- Not verified here: the image build itself and the platform's behavior
  (disk mount, TLS, health checks). There is no Docker daemon on the author's
  machine; the first deploy is the first image build, and `docs/DEPLOY.md`
  says to watch the build log if it fails.
- Platform facts were read from current documentation rather than recalled:
  Render's blueprint spec (field names such as `autoDeployTrigger`, `plan`
  IDs, `disk`, `healthCheckPath`, `generateValue`), the note that disks
  require a paid plan, and the free-tier page (0.1 CPU, fifteen-minute idle
  spin-down, filesystem reset on redeploy/restart/spin-down, no shell) before
  the blueprint default changed to free.
