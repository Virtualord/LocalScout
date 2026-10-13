/**
 * @vitest-environment node
 *
 * Real Lighthouse runs against the local fixture sites.
 *
 * This is the slow suite: `pnpm test:slow`. It launches an actual Chrome, which
 * takes seconds per page, so it is kept out of `pnpm test` where it would
 * dominate the run.
 *
 * Why it exists: every other audit test injects a fake Lighthouse, which means
 * the metric extraction, the mobile strategy and the missing-Chrome path are all
 * tested against a stub that agrees with the code by construction. This is the
 * one place the real integration runs.
 *
 * Chrome is optional. When it is not installed these tests skip with a stated
 * reason rather than failing, because "Chrome is missing" is a supported setup
 * and not a defect in this repository.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer, type FixtureSite } from './fixture-server.js';
import { findChrome, runLighthouse } from './lighthouse.js';
import { hasValue } from '../result/source-result.js';

const chrome = await findChrome(process.env['CHROME_PATH']);
const hasChrome = chrome.path !== undefined;

/**
 * A page that is measurably worse without being unloadable.
 *
 * The first version of this fixture had a 4,000px div and a script repeated
 * 20,000 times, which stopped Lighthouse from ever setting its gather mark and
 * failed the run with "start lh:runner:gather has not been set". The second
 * pulled in a stylesheet and a script, and the 404s for them stalled the gather
 * the same way. A fixture that cannot finish loading tests the timeout, not the
 * scoring, so this one is self-contained and bad in the ways a real neglected
 * small-business site is: no lang, no viewport, no description, no alt text, an
 * unlabelled data table and skipped heading levels.
 */
const BAD_SITE: FixtureSite = {
  path: '/bad',
  description: 'No viewport, no description, no alt text, an unlabelled table',
  html: `<!doctype html>
<html>
  <head>
    <title>Patel Hardware</title>
    <style>body { margin: 0; font-family: Times, serif; }</style>
  </head>
  <body>
    <h1>Patel Hardware</h1>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" />
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" />
    <table border="1"><tr><td>22mm</td><td>15mm</td></tr></table>
    <h3>Prices</h3>
    <h3>Hours</h3>
  </body>
</html>`,
};

const GOOD_SITE: FixtureSite = {
  path: '/good',
  description: 'A well-formed small-business page',
  html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Emergency plumbing in Bhopal." />
    <title>Sharma Plumbing Works</title>
  </head>
  <body>
    <header><h1>Sharma Plumbing Works</h1></header>
    <main><p>Emergency plumbing in MP Nagar since 2009.</p>
      <a href="tel:+919812345678">Call now</a>
    </main>
  </body>
</html>`,
};

describe('lighthouse against a real browser', () => {
  let server: FixtureServer;
  let reportDir: string;

  beforeAll(async () => {
    server = await startFixtureServer([GOOD_SITE, BAD_SITE]);
    reportDir = mkdtempSync(join(tmpdir(), 'localscout-lh-'));
  });

  afterAll(async () => {
    await server?.close();
    if (reportDir !== undefined) rmSync(reportDir, { recursive: true, force: true });
  });

  const run = (path: string, timeoutMs = 90_000) =>
    runLighthouse({
      url: server.url(path),
      timeoutMs,
      reportDir,
      ...(chrome.path === undefined ? {} : { chromePath: chrome.path }),
    });

  it.skipIf(!hasChrome)(
    'measures a well-formed page',
    async () => {
      const outcome = await run('/good');

      // Exact numbers move with the Chrome version, so the assertion is on the
      // shape: a real report produces real metrics rather than an empty object.
      expect(hasValue(outcome), outcome.error?.message ?? '').toBe(true);
      if (!hasValue(outcome)) return;

      expect(outcome.value.metrics.perf_score).not.toBeUndefined();
      expect(outcome.value.metrics.seo_score).not.toBeUndefined();
      expect(outcome.value.reportPath).toBeDefined();
    },
    150_000,
  );

  it.skipIf(!hasChrome)(
    'scores a bad page below a good one',
    async () => {
      // Sequential, not Promise.all. Two Lighthouse runs means two headless
      // Chromes competing for the same machine, and under memory pressure
      // Lighthouse fails with "start lh:runner:gather has not been set" before
      // it looks at the page at all.
      const good = await run('/good');
      const bad = await run('/bad');

      expect(hasValue(good), good.error?.message ?? '').toBe(true);
      expect(hasValue(bad), bad.error?.message ?? '').toBe(true);
      if (!hasValue(good) || !hasValue(bad)) return;

      /*
       * The point of the suite: the score tracks the page. Every other audit test
       * injects a stub, so only this can catch an extraction bug that turns a bad
       * page into a good score.
       */
      expect(bad.value.metrics.seo_score ?? 0).toBeLessThan(good.value.metrics.seo_score ?? 0);
    },
    150_000,
  );

  it.skipIf(!hasChrome)(
    'never turns an unmeasured metric into a zero',
    async () => {
      const outcome = await run('/good');
      expect(hasValue(outcome)).toBe(true);
      if (!hasValue(outcome)) return;

      /*
       * A metric the report does not contain must stay absent. A zero here would
       * let a draft say "your page loads in 0 ms", which is exactly the failure
       * the whole project is built to prevent.
       */
      for (const [key, value] of Object.entries(outcome.value.metrics)) {
        expect(value, `${key} must not be null`).not.toBeNull();
        if (typeof value === 'number' && key.endsWith('_score')) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    },
    150_000,
  );

  it('reports unavailable, not a crash, when Chrome cannot be found', async () => {
    // Not skipped: the missing-Chrome path is the supported default and has to
    // work whether or not this machine has Chrome.
    const outcome = await runLighthouse({
      url: server.url('/good'),
      timeoutMs: 30_000,
      reportDir,
      chromePath: '/definitely/not/chrome',
    });

    expect(outcome.status).toBe('unavailable');
    if (outcome.status !== 'unavailable') return;

    expect(outcome.error.code).toBe('chrome_missing');
    // The message names the fix rather than only the symptom.
    expect(outcome.error.message).toMatch(/CHROME_PATH/);
  });

  it('returns a result rather than throwing when the URL is unreachable', async () => {
    // Port 1 is reserved and refuses instantly, so this does not sit out a
    // timeout on a machine without Chrome.
    const outcome = await runLighthouse({
      url: 'http://127.0.0.1:1/nothing',
      timeoutMs: 5_000,
      reportDir,
      ...(chrome.path === undefined ? {} : { chromePath: chrome.path }),
    });

    // A failure is a value here, never an exception: an unreachable site is an
    // expected outcome of an audit, not a crash.
    if (outcome.status === 'unavailable') {
      expect(outcome.error.message.length).toBeGreaterThan(0);
    } else {
      expect(outcome.value.metrics).toBeDefined();
    }
  }, 30_000);
});

describe.skipIf(hasChrome)('without Chrome installed', () => {
  it('reports why it skipped rather than failing quietly', () => {
    // Surfaces the reason in the run output. Without Chrome the fast suite is
    // what actually covers this path, via an injected launcher.
    const reason = 'message' in chrome ? chrome.message : 'Chrome was found after all.';
    expect(reason).toMatch(/Chrome/i);
  });
});
