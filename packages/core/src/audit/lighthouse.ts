import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { unavailable, type SourceResult } from '../result/source-result.js';

/**
 * Lighthouse runner.
 *
 * Lighthouse is the only source of the performance numbers a draft is allowed to
 * quote, so two rules matter more than speed:
 *
 * 1. **A missing metric is never invented.** If Chrome is absent or the run
 *    times out, this returns `unavailable` with no metrics, and the audit layer
 *    reports `stale`. It does not substitute a guess.
 * 2. **The Chrome process is always killed.** A leaked headless browser holds a
 *    profile lock and several hundred MB of memory, and the audit runs once per
 *    lead. Cleanup runs in a `finally`, including on the timeout path.
 *
 * The mobile preset with simulated throttling is used deliberately: these are
 * lab numbers on one device class, which is why drafts say "in a mobile speed
 * test I ran" rather than making a claim about the visitor's own experience.
 */

export interface LighthouseRunOptions {
  /** URL to audit. */
  url: string;
  timeoutMs: number;
  /** Where to write the raw JSON report. */
  reportDir: string;
  /** Explicit Chrome binary; auto-detected when absent. */
  chromePath?: string | undefined;
  /** Injected for tests. */
  runLighthouse?: LighthouseFn;
  /** Injected for tests. */
  launchChrome?: LaunchChromeFn;
}

export interface LighthouseMetrics {
  lcp_ms?: number;
  cls?: number;
  tbt_ms?: number;
  perf_score?: number;
  seo_score?: number;
  a11y_score?: number;
}

export interface LighthouseOutcome {
  metrics: LighthouseMetrics;
  /** Path to the raw report, when one was written. */
  reportPath?: string;
  /** True when the Lighthouse viewport audit failed, feeding NOT_MOBILE_READY. */
  viewportFailed?: boolean;
}

export type LighthouseFn = (
  url: string,
  flags: Record<string, unknown>,
  config: unknown,
) => Promise<{ lhr: unknown }>;

export type LaunchChromeFn = (flags: { chromeFlags: string[] }) => Promise<{
  port: number;
  kill: () => void;
}>;

/**
 * Find an installed Chrome or Chromium.
 *
 * Returns the path, or undefined with a message naming what to install. A
 * missing browser degrades the audit, it does not fail it.
 */
export async function findChrome(
  configuredPath?: string,
): Promise<{ path: string } | { path: undefined; message: string }> {
  if (configuredPath) {
    try {
      await access(configuredPath, constants.X_OK);
      return { path: configuredPath };
    } catch {
      return {
        path: undefined,
        message: `CHROME_PATH points to "${configuredPath}", which is not executable. Fix CHROME_PATH in .env, or leave it empty to auto-detect.`,
      };
    }
  }

  try {
    // chrome-launcher already knows every platform's install locations and
    // throws ChromePathNotSetError when there is none.
    const { getChromePath } = await import('chrome-launcher');
    return { path: getChromePath() };
  } catch {
    return {
      path: undefined,
      message:
        'Chrome or Chromium was not found, so Lighthouse could not run. Install Chrome, or set CHROME_PATH in .env. The audit will still report the HTTP and HTML checks.',
    };
  }
}

/**
 * Run Lighthouse and extract the metrics a draft may quote.
 *
 * Only keys actually present in the report are returned. An absent metric stays
 * absent, so a downstream draft can never claim a measurement that was not taken.
 */
export async function runLighthouse(
  options: LighthouseRunOptions,
): Promise<SourceResult<LighthouseOutcome>> {
  const started = Date.now();

  const chrome = await findChrome(options.chromePath);
  if (chrome.path === undefined) {
    return unavailable(
      'audit',
      { code: 'chrome_missing', message: chrome.message },
      Date.now() - started,
    );
  }

  const launch = options.launchChrome ?? defaultLaunchChrome;
  const run = options.runLighthouse ?? defaultRunLighthouse;

  let browser: Awaited<ReturnType<LaunchChromeFn>> | undefined;
  const timeoutMs = options.timeoutMs;

  try {
    browser = await launch({
      chromeFlags: [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        // Auditing one page at a time; these keep a 50-lead run from exhausting
        // the machine's file descriptors.
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    // Hard timeout. Lighthouse's own flags cannot bound a hung browser, so the
    // promise is raced and the process killed below.
    const result = await withTimeout(
      run(options.url, { port: browser.port, logLevel: 'error', output: 'json' }, mobileConfig()),
      timeoutMs,
    );

    const lhr = result.lhr as LighthouseReport | undefined;
    if (!lhr) {
      return unavailable(
        'audit',
        { code: 'lighthouse_no_report', message: 'Lighthouse returned no report.' },
        Date.now() - started,
      );
    }

    const metrics = extractMetrics(lhr);
    const reportPath = await writeReport(options.reportDir, lhr);
    const viewportFailed = viewportAuditFailed(lhr);

    return {
      status: 'ok',
      kind: 'audit',
      value: {
        metrics,
        ...(reportPath !== undefined ? { reportPath } : {}),
        ...(viewportFailed !== undefined ? { viewportFailed } : {}),
      },
      meta: { durationMs: Date.now() - started, at: new Date().toISOString() },
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return unavailable(
      'audit',
      {
        code: isTimeout ? 'lighthouse_timeout' : 'lighthouse_failed',
        message: isTimeout
          ? `Lighthouse did not finish within ${timeoutMs}ms. Raise AUDIT_TIMEOUT_MS, or skip the performance section.`
          : `Lighthouse failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      Date.now() - started,
    );
  } finally {
    // Always kill Chrome. Skipping this leaks a browser per audited site.
    try {
      browser?.kill();
    } catch {
      // The process may already be gone, which is the desired outcome.
    }
  }
}

/** Lighthouse's mobile preset with simulated throttling. */
function mobileConfig(): unknown {
  return {
    extends: 'lighthouse:default',
    settings: {
      formFactor: 'mobile',
      screenEmulation: {
        mobile: true,
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
        disabled: false,
      },
      // Simulated, so the number is reproducible on any machine rather than
      // depending on the local CPU.
      throttlingMethod: 'simulate',
      onlyCategories: ['performance', 'seo', 'accessibility'],
    },
  };
}

/** The parts of an LHR this app reads. */
interface LighthouseReport {
  finalDisplayedUrl?: string;
  categories?: Record<string, { score?: number | null }>;
  audits?: Record<string, { numericValue?: number; score?: number | null }>;
}

function score(categories: LighthouseReport['categories'], id: string): number | undefined {
  const value = categories?.[id]?.score;
  return typeof value === 'number' ? Math.round(value * 100) : undefined;
}

/** Pull out only the metrics that were actually measured. */
export function extractMetrics(lhr: LighthouseReport): LighthouseMetrics {
  const audits = lhr.audits ?? {};

  const lcp = audits['largest-contentful-paint']?.numericValue;
  const cls = audits['cumulative-layout-shift']?.numericValue;
  const tbt = audits['total-blocking-time']?.numericValue;

  const metrics: LighthouseMetrics = {};

  if (typeof lcp === 'number') metrics.lcp_ms = Math.round(lcp);
  if (typeof cls === 'number') metrics.cls = Number(cls.toFixed(3));
  if (typeof tbt === 'number') metrics.tbt_ms = Math.round(tbt);

  const perf = score(lhr.categories, 'performance');
  const seo = score(lhr.categories, 'seo');
  const a11y = score(lhr.categories, 'accessibility');

  if (perf !== undefined) metrics.perf_score = perf;
  if (seo !== undefined) metrics.seo_score = seo;
  if (a11y !== undefined) metrics.a11y_score = a11y;

  return metrics;
}

/** Whether Lighthouse's own viewport audit failed, corroborating NOT_MOBILE_READY. */
function viewportAuditFailed(lhr: LighthouseReport): boolean | undefined {
  const audit = lhr.audits?.['viewport'];
  if (!audit) return undefined;
  return audit.score === 0;
}

async function writeReport(reportDir: string, lhr: LighthouseReport): Promise<string | undefined> {
  try {
    await mkdir(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `${reportDir}/lighthouse-${stamp}.json`;
    await writeFile(file, JSON.stringify(lhr, null, 2), 'utf8');
    return file;
  } catch {
    // The report is a convenience for a human; failing to write it must not
    // discard metrics that were successfully measured.
    return undefined;
  }
}

/** Default Chrome launcher, delegating to chrome-launcher. */
const defaultLaunchChrome: LaunchChromeFn = async (flags) => {
  const { launch } = await import('chrome-launcher');
  return launch(flags);
};

/** Default Lighthouse invocation. */
const defaultRunLighthouse: LighthouseFn = async (url, flags, config) => {
  const mod = await import('lighthouse');
  const lighthouse = (mod.default ?? mod) as LighthouseFn;
  return lighthouse(url, flags, config);
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Lighthouse timed out after ${ms}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
