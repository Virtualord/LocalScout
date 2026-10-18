# Manual steps

Things only a person can do, with exact commands. Everything else in this
repository is automated.

## 1. Install Chrome or Chromium (optional but recommended)

Lighthouse needs a Chrome binary. Without it, audits still run their HTTP and HTML
checks, but no performance numbers are produced and those audits report as
`stale`. The app works fully without it.

```bash
# Debian or Ubuntu
sudo apt-get install -y chromium

# macOS
brew install --cask chromium

# Or download Chrome from google.com/chrome
```

Verify:

```bash
which google-chrome chromium chromium-browser
```

If it lives somewhere unusual, set `CHROME_PATH` in `.env` to the full path.

## 2. Install Ollama and pull a small Gemma model (optional)

Only needed for model-written drafts. The default `LLM_PROVIDER=fixture` returns
recorded drafts, which is enough to run the whole app offline.

```bash
# Install from https://ollama.com/download
ollama serve            # in a separate terminal; it must be running

# Check what you already have
ollama list

# Pull a small Gemma. Pick the newest tag your machine can run.
ollama pull gemma3:4b
```

Then in `.env`:

```
LLM_PROVIDER=ollama
LLM_MODEL=gemma3:4b
```

Verify:

```bash
curl -s http://127.0.0.1:11434/api/tags
```

If Ollama is not reachable the Settings screen says so and tells you to run
`ollama serve`.

## 3. Create a SerpApi account (optional)

Only needed to search real businesses instead of the recorded fixtures. Free
tier is roughly 250 searches a month.

1. Sign up at <https://serpapi.io>.
2. Copy the API key from the dashboard.
3. Create `.env` by copying `.env.example`, which is the template listing every
   setting with its default:

   ```bash
   cp .env.example .env
   ```

4. Put the key in `.env` and switch discovery on:

   ```
   DISCOVERY_MODE=live
   SERPAPI_API_KEY=your_key_here
   ```

5. Restart `pnpm dev`. The banner prints `Discovery: live`, and the Settings
   screen says a SerpApi key is set.

The file is read at startup from the repository root, whichever directory the
command was launched from. A variable already exported in your shell wins over
the file, so `SERPAPI_API_KEY=... pnpm dev` still works.

**Never commit `.env`.** It is git-ignored, and a pre-commit hook fails the
commit if a key-shaped string is staged. Responses are cached on disk by a hash
of the request, so re-running the same search costs nothing — one search per
distinct query-and-city pair, and 250 a month on the free tier.

## 4. Fill in your sender profile

The Settings screen writes `config/sender.local.json`, which is git-ignored. Or
set it in `.env`:

```
SENDER_NAME=Your Name
SENDER_PORTFOLIO_URL=https://yourwork.example/
SENDER_SERVICES=website redesign, mobile-friendly sites, speed fixes
```

A name and portfolio make the drafts read like a person wrote them. Without a
name the message says "I build websites" rather than "I am ..., I build ...".

## 5. Drop the reference material in `ref/` (optional)

If you have the screen recording or the hero screenshot, put it in `ref/`. The
folder is git-ignored, because the recording shows a desktop, browser tabs, and an
account email address.

```bash
mkdir -p ref
cp ~/Downloads/recording.mp4 ref/
cp ~/Downloads/hero.png ref/
```

Compare side by side against `pnpm dev` while tuning. `docs/DESIGN_REFERENCE.md`
lists which effects are observed and which are inferred.

## 6. Run a real batch, review every draft, send a few by hand

This is the actual product, and it is the part no test can do for you.

```bash
# 1. Start the app
pnpm dev

# 2. Or run a batch straight from the terminal
pnpm cli "plumbers" Bhopal --limit 20
```

Then, for each lead:

1. Open the lead and read the **Audit** tab. Check the findings against the real
   site. If something looks wrong, press **Re-audit**.
2. Read the **Message** tab. Confirm every number in the message matches the
   audit. The badge says whether the numbers were verified.
3. Copy the message, paste it into WhatsApp, and **send it yourself**.
4. Press **Mark as sent**, which records it in the outreach log.

Localscout never sends anything. There is no send code path.

## 7. Take screenshots for the write-up

```bash
# Hero
pnpm dev  # then capture http://localhost:5173/

# Run an eval to get real numbers
EVAL_MODELS=gemma3:4b pnpm eval
# writes eval/results/<date>.md
```

Put the images somewhere that is not this repository if they contain a real
business's name, or accept that the write-up shows fixture data.

## 8. Create the GitHub remote and push

The repository has **no remote and has never been pushed**, by design.

```bash
gh repo create localscout --private --source=. --push
```

Before pushing, confirm nothing private is staged:

```bash
git status --short
git check-ignore -v data config/sender.local.json ref .env
```

Every one of those should report that it is ignored.

## 9. Deploy to a container host (optional)

Only if you want an always-on URL. The whole walkthrough, the switch for live
discovery, and the cost list are in [DEPLOY.md](DEPLOY.md); the shape of it:

```bash
# 1. Push the repository (step 8 above).

# 2. In the host's dashboard: New > Blueprint, pick this repository.
#    The repository ships the Dockerfile and render.yaml the blueprint reads.

# 3. Open the deployed URL. The browser asks to sign in once: any username,
#    and the AUTH_TOKEN the platform generated as the password.
```

Why the deploy is a single service, why Vercel and other serverless hosts
cannot run the API, and what the carve-out costs are in
[ADR-0004](adr/0004-cloud-deploy-carve-out.md).
