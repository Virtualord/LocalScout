# Deploying Localscout

Localscout is local-first: `pnpm dev` on one machine is the intended way to run
it, and nothing here changes that default. This document is the opt-in second
way — the same app on a container host, at a personal URL — for when an
always-on address matters more than keeping every byte on your own disk.
[ADR-0004](adr/0004-cloud-deploy-carve-out.md) records why the carve-out looks
the way it does and what it costs.

## What runs where

| Piece                                                     | Host                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| API, runs, SQLite, Lighthouse, the built interface        | One container service with a persistent disk (Render is the reference) |
| A static-only host (Vercel, Netlify) for the interface UI | Not supported as a deploy shape — see below                            |

**Why not Vercel (or any serverless host) for the API.** This is a shape
problem, not a config problem:

- SQLite is a file and functions have no persistent filesystem; the lead
  database would reset between invocations.
- Audits run Lighthouse against a real Chrome; there is no browser binary in
  a serverless runtime.
- A run is minutes of in-process work with an SSE stream attached; functions
  are request-scoped with timeout ceilings and no place to keep run state.

Hosting just the interface statically is possible in principle, but the API
still needs a container host with a disk, and splitting the two would add CORS
between the halves and auth on the SSE stream — for a single-user tool, that is
two deployments and new failure modes for no gain. This repository ships the
single-service shape instead.

Any platform that runs a Dockerfile with a mounted volume works the same way:
Fly.io, Railway, or a VPS with Docker and a TLS reverse proxy in front. The
blueprint and walkthrough below use Render because it is the one this
repository configures.

## What the deploy includes

- **The API and the interface in one origin.** `SERVE_WEB=true` makes the API
  serve the built React app, so the browser sees a single origin and the SSE
  progress stream needs no cross-origin negotiation.
- **The database on the host's disk.** `DATA_DIR` points at the mounted
  volume; delete it and you start completely fresh, exactly like `./data`
  locally.
- **Chromium in the image.** Audits measure instead of degrading to `stale`.
- **A token in front of everything.** A non-loopback bind is refused without
  `AUTH_TOKEN`, and the token gates every route except `/api/health`, which
  platform health checks need and which returns no secret.

## Deploy on Render

1. **Push the repository to GitHub** if you have not (see
   [MANUAL_STEPS.md](MANUAL_STEPS.md), step 8).
2. **Create the service from the blueprint.** In the Render dashboard choose
   _New → Blueprint_, pick the repository, and apply. Render reads
   [`render.yaml`](../render.yaml): one Docker web service, a 1 GB disk at
   `/var/data`, and the environment variables the app expects.
3. **Answer the prompts.** `SERPAPI_API_KEY`, `SENDER_NAME` and
   `SENDER_PORTFOLIO_URL` are asked for once and may be left blank. Everything
   else has a working default; the app starts in fixtures mode.
4. **Copy the generated token.** Open the service's _Environment_ tab and copy
   `AUTH_TOKEN`. Render generated it; it is the only way in.
5. **Open the URL.** Visit `https://<service-name>.onrender.com`. The browser
   asks you to sign in once: any username, and the `AUTH_TOKEN` value as the
   password. The same credential covers the interface, the API, and the live
   progress stream.
6. **Check the Settings screen.** It reads `/api/health` and says what is
   present and what each missing key would change.

### Free plan versus paid

- **Free** has no disks and sleeps after idle periods. The app runs, but the
  database resets on every deploy and restart. To try it, remove the `disk`
  block and set `plan: free` in `render.yaml` first.
- **Paid** (`0.5c-512mb` in the blueprint) keeps the data and stays warm.
  Lighthouse is CPU-bound: a batch of audits takes minutes on 0.5 CPU, roughly
  half that on `1c-2g`.

## Turning on the real thing

The deployed default is fixtures mode, so the first deploy costs nothing and
needs no keys. From there, each switch is an environment variable, editable in
the Render dashboard (the service redeploys on save):

| Want                         | Set                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Real businesses              | `DISCOVERY_MODE=live` and `SERPAPI_API_KEY=...`                                                             |
| Model-written drafts         | `LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL=...` (a `/v1` endpoint), `LLM_MODEL=...`, `LLM_API_KEY=...` |
| Your name in the drafts      | `SENDER_NAME`, `SENDER_PORTFOLIO_URL`                                                                       |
| Saved searches on a schedule | `SCHEDULER_ENABLED=true` (off by default)                                                                   |

Ollama cannot realistically run on a small container host, so hosted drafting
means an OpenAI-compatible endpoint and its bill; the fixture provider remains
the fallback, and a draft that falls back to its template is still grounded.

### What fixtures mode does on a server

Worth knowing before you interpret the first run: discovery serves the 35
recorded listings, and drafting uses canned drafts. Audits visit the website on
each recorded listing — the fixture domains are invented and mostly do not
resolve, so those audits honestly report `unavailable` rather than pretending.
Listings without a website still score and draft through the normal path. For
real measurements of real sites, that is what `DISCOVERY_MODE=live` is for.

## Operating it

- **Updates.** With `autoDeployTrigger: commit`, every push to the connected
  branch rebuilds and redeploys. Watch the build log for the first deploy: CI
  does not build this image, so the platform's build is the first one.
- **Logs and failures.** A configuration problem (a bad `HOST`, a short
  `AUTH_TOKEN`, `SERVE_WEB=true` without a build) fails at boot with a sentence
  naming the variable, in the deploy log, exactly as it would locally.
- **Backups.** The database is one file, `/var/data/localscout.db`, on the
  disk. From the Render shell, or a one-off job that mounts the same disk,
  copy it out; the SerpApi response cache next to it is disposable.
- **Rotating the token.** Change `AUTH_TOKEN` in the dashboard and redeploy;
  every browser is asked to sign in again.
- **What a visitor with the URL can see.** Without the token: nothing but a
  sign-in prompt and `/api/health` (key-presence booleans, active modes, the
  database path). With it: everything, which is the point — the token is one
  shared secret, not accounts.

## Costs, all of them

- The Render plan, monthly, whether the app is used or not.
- SerpApi searches on the free tier's ~250/month when live discovery is on;
  responses are cached on disk by request hash, so a repeated search is free.
- The hosted LLM bill, if one is configured; zero in fixtures mode.

## If the first deploy fails

Read the build log first — a Dockerfile typo or an apt hiccup is visible
there. A boot failure prints the same sentence the app prints locally, naming
the offending variable. A service that deploys but 503s on `/api/health` is
usually the disk: the database check is the one blocking check, and its fix
line says to make `DATA_DIR` writable.
