import { APP_VERSION } from '../app.js';
import type { AuditCheck, AuditMetrics, AuditStatus } from '../db/schema.js';
import { hasRealWebsite } from '../discovery/domain-key.js';
import { ok, stale, unavailable, type SourceResult } from '../result/source-result.js';
import { deriveFindings, scoreLead, type FindingInput } from '../scoring/findings.js';
import { findPublicEmail, runHtmlChecks } from './html-checks.js';
import { runLighthouse, type LighthouseMetrics } from './lighthouse.js';
import { SafeFetchError, safeFetch, type SafeFetchOptions } from './safe-fetch.js';

/**
 * The audit.
 *
 * Turns one website URL into a measured, scored result. Three properties matter
 * more than anything else here:
 *
 * 1. **A partial audit says so.** When Lighthouse fails but the HTTP checks
 *    worked, the status is `stale` and the metrics are absent rather than
 *    invented. A missing metric and a zero metric are different things, and the
 *    draft layer relies on that difference.
 * 2. **One visit per site.** The deterministic checks read the body already
 *    fetched for reachability rather than requesting the page again, so a site
 *    is loaded once per audit regardless of how many checks run against it.
 * 3. **Lab data stays labelled.** These are simulated mobile numbers from one
 *    device class, which is why every finding label says what was measured.
 */

export interface AuditRequest {
  /** The lead's website, possibly absent or a social page. */
  websiteUrl: string | undefined;
  rating?: number | undefined;
  reviewCount?: number | undefined;
}

export interface AuditConfig {
  timeoutMs: number;
  reportDir: string;
  chromePath?: string | undefined;
  /** Skip Lighthouse entirely, for a fast HTML-only pass. */
  skipLighthouse?: boolean;
  /** Injected for tests. */
  fetchOptions?: SafeFetchOptions;
  /** Injected for tests. */
  runLighthouseFn?: typeof runLighthouse;
}

export interface AuditResult {
  /** True when the business has a site of its own to audit. */
  hasWebsite: boolean;
  status: AuditStatus;
  metrics: AuditMetrics;
  checks: AuditCheck[];
  findings: ReturnType<typeof deriveFindings>;
  opportunityScore: number;
  durationMs: number;
  /** Public email read from a mailto: on the site's own page. */
  contactEmail?: string;
  /** Where the raw Lighthouse JSON was written. */
  reportPath?: string;
  /** Which components degraded, for the UI. */
  degradedBy: string[];
}

export async function auditWebsite(
  request: AuditRequest,
  config: AuditConfig,
): Promise<SourceResult<AuditResult>> {
  const started = Date.now();

  // A social page or directory listing is not a website. Say so plainly rather
  // than auditing Facebook and reporting its own performance problems.
  if (!hasRealWebsite(request.websiteUrl)) {
    const findings = deriveFindings({
      hasWebsite: false,
      unreachable: false,
      checks: [],
      metrics: {},
    });
    const scored = scoreLead({
      findings,
      rating: request.rating,
      reviewCount: request.reviewCount,
    });

    const result: AuditResult = {
      hasWebsite: false,
      status: 'ok',
      metrics: {},
      checks: [],
      findings,
      opportunityScore: scored.score,
      durationMs: Date.now() - started,
      degradedBy: [],
    };

    return ok('audit', result, Date.now() - started);
  }

  const url = request.websiteUrl as string;

  // Two attempts: a single failed request is often a blip, and reporting a site
  // as broken because of one timeout would be a lie to the user.
  let page: Awaited<ReturnType<typeof safeFetch>> | undefined;
  let lastError: SafeFetchError | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      page = await safeFetch(url, { timeoutMs: config.timeoutMs, ...config.fetchOptions });
      break;
    } catch (error) {
      if (error instanceof SafeFetchError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (!page) {
    // Nothing was measured, so there is no value to return. A hypothetical
    // SITE_UNREACHABLE finding is deliberately not synthesised here: it is only
    // reported when the server answered with an error status, which is a
    // different fact from "the connection never completed".
    return unavailable(
      'audit',
      {
        code: lastError?.code ?? 'site_unreachable',
        message:
          lastError?.message ??
          `"${url}" could not be reached on two attempts. The listing may be out of date.`,
      },
      Date.now() - started,
    );
  }

  if (!page.ok) {
    // A 404 or 500 is a reachable site with a broken page. That is a finding,
    // not an unavailable audit.
    const findings = deriveFindings({
      hasWebsite: true,
      unreachable: true,
      checks: [],
      metrics: {},
    });
    const scored = scoreLead({
      findings,
      rating: request.rating,
      reviewCount: request.reviewCount,
    });

    return ok(
      'audit',
      {
        hasWebsite: true,
        status: 'ok',
        metrics: {},
        checks: [],
        findings,
        opportunityScore: scored.score,
        durationMs: Date.now() - started,
        degradedBy: ['http'],
      },
      Date.now() - started,
    );
  }

  // Reuse the body already fetched. One visit per site.
  const checks = runHtmlChecks({
    html: page.body,
    finalUrl: page.finalUrl,
    https: page.finalUrl.startsWith('https://'),
    reachable: true,
  });

  const degradedBy: string[] = [];
  let metrics: LighthouseMetrics = {};
  let reportPath: string | undefined;
  let viewportFailed: boolean | undefined;

  if (config.skipLighthouse !== true) {
    const runFn = config.runLighthouseFn ?? runLighthouse;
    const lighthouse = await runFn({
      url: page.finalUrl,
      timeoutMs: config.timeoutMs,
      reportDir: config.reportDir,
      ...(config.chromePath !== undefined ? { chromePath: config.chromePath } : {}),
      ...(config.fetchOptions?.resolver ? { resolver: config.fetchOptions.resolver } : {}),
    });

    if (lighthouse.value !== undefined) {
      metrics = lighthouse.value.metrics;
      reportPath = lighthouse.value.reportPath;
      viewportFailed = lighthouse.value.viewportFailed;
    } else {
      // The HTTP checks are real, so this is a partial result, not a failure.
      degradedBy.push('lighthouse');
    }
  } else {
    degradedBy.push('lighthouse');
  }

  const findingInput: FindingInput = {
    hasWebsite: true,
    unreachable: false,
    checks,
    metrics,
    ...(viewportFailed !== undefined ? { viewportFailed } : {}),
  };

  const findings = deriveFindings(findingInput);
  const scored = scoreLead({
    findings,
    rating: request.rating,
    reviewCount: request.reviewCount,
  });

  const contactEmail = findPublicEmail(checks);

  const result: AuditResult = {
    hasWebsite: true,
    status: degradedBy.length > 0 ? 'stale' : 'ok',
    metrics,
    checks,
    findings,
    opportunityScore: scored.score,
    durationMs: Date.now() - started,
    ...(contactEmail !== undefined ? { contactEmail } : {}),
    ...(reportPath !== undefined ? { reportPath } : {}),
    degradedBy,
  };

  if (result.status === 'stale') {
    return stale(
      'audit',
      result,
      {
        code: degradedBy.includes('lighthouse') ? 'lighthouse_unavailable' : 'partial',
        message: degradedBy.includes('lighthouse')
          ? 'Lighthouse could not run, so no performance numbers were measured. The HTTP and HTML checks below are complete.'
          : 'Some checks were skipped.',
      },
      Date.now() - started,
      degradedBy,
    );
  }

  return ok('audit', result, Date.now() - started);
}

/** Version stamped into saved Lighthouse reports, for traceability. */
export const AUDIT_ENGINE_VERSION = APP_VERSION;
