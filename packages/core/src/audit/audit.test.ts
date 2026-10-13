import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditWebsite, type AuditConfig, type AuditResult } from './audit.js';
import { INDEX_SITE, startFixtureServer, type FixtureServer } from './fixture-server.js';
import type { LighthouseMetrics, runLighthouse } from './lighthouse.js';
import type { Resolver } from './ssrf.js';

/**
 * Integration tests for the audit against local fixture sites.
 *
 * Lighthouse is skipped by default: it needs Chrome, which is an optional
 * dependency. The real Lighthouse path is covered by `pnpm test:slow`, and the
 * degraded path (no Chrome) is covered here because that is what most machines
 * will actually hit.
 */

/** Lets the fixture server be reached while keeping every other SSRF rule. */
const fixtureResolver: Resolver = async (hostname) => {
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return { addresses: ['127.0.0.1'], allowLoopback: true };
  }
  return { addresses: ['93.184.216.34'] };
};

describe('auditWebsite against local fixture sites', () => {
  let server: FixtureServer;
  let reportDir: string;

  beforeAll(async () => {
    server = await startFixtureServer();
    reportDir = mkdtempSync(join(tmpdir(), 'localscout-reports-'));
  });

  afterAll(async () => {
    await server.close();
    rmSync(reportDir, { recursive: true, force: true });
  });

  const audit = (path: string, overrides: Partial<AuditConfig> = {}) =>
    auditWebsite(
      { websiteUrl: server.url(path) },
      {
        timeoutMs: 5000,
        reportDir,
        skipLighthouse: true,
        fetchOptions: { resolver: fixtureResolver },
        ...overrides,
      },
    );

  const valueOf = async (path: string, overrides?: Partial<AuditConfig>) => {
    const result = await audit(path, overrides);
    expect(result.value, JSON.stringify(result.error)).toBeDefined();
    return result.value as AuditResult;
  };

  describe('no website', () => {
    it('reports NO_WEBSITE for a lead with no site', async () => {
      const value = await auditWebsite(
        { websiteUrl: undefined },
        { timeoutMs: 1000, reportDir, skipLighthouse: true },
      );

      expect(value.value?.hasWebsite).toBe(false);
      expect(value.value?.findings.map((f) => f.id)).toEqual(['NO_WEBSITE']);
      expect(value.value?.opportunityScore).toBe(70);
      expect(value.status).toBe('ok');
    });

    it('treats a facebook page as no website', async () => {
      const value = await auditWebsite(
        { websiteUrl: 'https://facebook.com/patelcoolers', rating: 4.8, reviewCount: 342 },
        { timeoutMs: 1000, reportDir, skipLighthouse: true },
      );

      expect(value.value?.hasWebsite).toBe(false);
      expect(value.value?.findings.map((f) => f.id)).toEqual(['NO_WEBSITE']);
      // Activity bonus applies on top of the no-website weight.
      expect(value.value?.opportunityScore).toBe(80);
    });

    it('treats a directory listing as no website', async () => {
      const value = await auditWebsite(
        { websiteUrl: 'https://www.justdial.com/Bhopal/Painters/99887766' },
        { timeoutMs: 1000, reportDir, skipLighthouse: true },
      );
      expect(value.value?.hasWebsite).toBe(false);
    });
  });

  describe('a healthy site', () => {
    // The fixture server speaks plain HTTP, so NO_HTTPS is measured on every
    // fixture. It is filtered out here so these tests can assert on the checks
    // that are about page quality rather than transport.
    const idsExceptHttps = (value: AuditResult) =>
      value.findings.map((f) => f.id).filter((id) => id !== 'NO_HTTPS');

    it('reports no findings other than the expected http one', async () => {
      const value = await valueOf('/good');
      expect(idsExceptHttps(value)).toEqual([]);
      expect(value.findings.map((f) => f.id)).toContain('NO_HTTPS');
      // Stale, because Lighthouse was skipped for these tests, not because the
      // page is unhealthy.
      expect(value.status).toBe('stale');
    });

    it('scores only the http finding on an otherwise healthy page', async () => {
      const value = await valueOf('/good');
      expect(value.opportunityScore).toBe(25);
    });

    it('records the public email from the mailto link', async () => {
      const value = await valueOf('/good');
      expect(value.contactEmail).toBe('hello@sharmaplumbing.in');
    });

    it('runs every check', async () => {
      const value = await valueOf('/good');
      expect(value.checks).toHaveLength(8);
      // Only the https check can fail against a local http fixture server.
      const failing = value.checks.filter((entry) => !entry.passed).map((entry) => entry.id);
      expect(failing).toEqual(['https']);
    });
  });

  describe('structural failures', () => {
    it('flags a missing viewport', async () => {
      const value = await valueOf('/no-viewport');
      expect(value.findings.map((f) => f.id)).toContain('NOT_MOBILE_READY');
    });

    it('flags a missing meta description and a generic title', async () => {
      const ids = (await valueOf('/no-meta')).findings.map((f) => f.id);
      expect(ids).toContain('MISSING_META_DESCRIPTION');
      expect(ids).toContain('MISSING_TITLE');
    });

    it('flags missing contact links', async () => {
      const ids = (await valueOf('/no-contact')).findings.map((f) => f.id);
      expect(ids).toContain('NO_TAP_TO_CALL');
      expect(ids).toContain('NO_WHATSAPP_LINK');
    });

    it('does not find a public email where there is no mailto', async () => {
      expect((await valueOf('/no-contact')).contactEmail).toBeUndefined();
    });
  });

  describe('failure modes', () => {
    it('reports a 404 site as unreachable rather than crashing', async () => {
      const value = await valueOf('/not-found');
      expect(value.findings.map((f) => f.id)).toEqual(['SITE_UNREACHABLE']);
      expect(value.status).toBe('ok');
      expect(value.degradedBy).toContain('http');
    });

    it('reports a 500 the same way', async () => {
      const value = await valueOf('/server-error');
      expect(value.findings.map((f) => f.id)).toEqual(['SITE_UNREACHABLE']);
    });

    it('returns unavailable when the site cannot be reached at all', async () => {
      // Port 9 is the discard port: nothing listens, so both attempts fail.
      const result = await auditWebsite(
        { websiteUrl: 'http://127.0.0.1:9/' },
        {
          timeoutMs: 500,
          reportDir,
          skipLighthouse: true,
          fetchOptions: { resolver: fixtureResolver, timeoutMs: 300 },
        },
      );

      expect(result.status).toBe('unavailable');
      expect(result.error?.code).toBeDefined();
      expect(result.value).toBeUndefined();
    });

    it('times out on a slow site rather than hanging', async () => {
      const result = await audit('/slow', {
        fetchOptions: { resolver: fixtureResolver, timeoutMs: 200 },
      });
      // Two attempts, then an honest unavailable.
      expect(result.status).toBe('unavailable');
    }, 15_000);

    it('handles a non-html response without inventing checks', async () => {
      const value = await valueOf('/not-html');
      // No markup means no tags, so the structural findings are reported as
      // measured absences rather than skipped.
      expect(value.checks.length).toBeGreaterThan(0);
      expect(value.findings.map((f) => f.id)).toContain('MISSING_TITLE');
    });
  });

  describe('degradation', () => {
    it('is stale, with no metrics, when lighthouse is skipped', async () => {
      const value = await valueOf('/good');
      expect(value.status).toBe('stale');
      expect(value.degradedBy).toContain('lighthouse');
    });

    it('never fabricates metrics when lighthouse did not run', async () => {
      const value = await valueOf('/good');
      expect(value.metrics).toEqual({});
      // Specifically: no zeros pretending to be measurements.
      expect(value.metrics.lcp_ms).toBeUndefined();
      expect(value.metrics.perf_score).toBeUndefined();
    });

    it('still produces findings and a score without lighthouse', async () => {
      const value = await valueOf('/no-contact');
      expect(value.findings.length).toBeGreaterThan(0);
      expect(value.opportunityScore).toBeGreaterThan(0);
    });
  });

  describe('lighthouse integration', () => {
    /**
     * A stub that reports fixed metrics, so the merge path is testable without
     * Chrome. Typed as the real runner's signature so a change there becomes a
     * compile error here rather than a silently wrong cast.
     */
    const stubLighthouse =
      (metrics: LighthouseMetrics, viewportFailed?: boolean): typeof runLighthouse =>
      async () => ({
        status: 'ok',
        kind: 'audit',
        value: { metrics, ...(viewportFailed !== undefined ? { viewportFailed } : {}) },
        meta: { durationMs: 1234, at: new Date().toISOString() },
      });

    it('merges measured metrics into the findings', async () => {
      const value = await valueOf('/good', {
        skipLighthouse: false,
        runLighthouseFn: stubLighthouse({ lcp_ms: 6100, cls: 0.31, tbt_ms: 800, perf_score: 38 }),
      });

      expect(value.status).toBe('ok');
      const ids = value.findings.map((f) => f.id);
      expect(ids).toContain('SLOW_LCP');
      expect(ids).toContain('LAYOUT_SHIFT');
      expect(ids).toContain('HIGH_TBT');
      expect(ids).toContain('LOW_PERF_SCORE');
    });

    it('records the measured value as evidence', async () => {
      const value = await valueOf('/good', {
        skipLighthouse: false,
        runLighthouseFn: stubLighthouse({ lcp_ms: 6100 }),
      });

      const slow = value.findings.find((f) => f.id === 'SLOW_LCP');
      expect(slow?.evidence['lcp_ms']).toBe(6100);
    });

    it('honours the moderate weight band', async () => {
      const value = await valueOf('/good', {
        skipLighthouse: false,
        runLighthouseFn: stubLighthouse({ lcp_ms: 3000 }),
      });

      const slow = value.findings.find((f) => f.id === 'SLOW_LCP');
      expect(slow?.weight).toBe(15);
    });

    it('flags mobile readiness from a lighthouse viewport failure alone', async () => {
      const value = await valueOf('/good', {
        skipLighthouse: false,
        runLighthouseFn: stubLighthouse({ perf_score: 95 }, true),
      });

      expect(value.findings.map((f) => f.id)).toContain('NOT_MOBILE_READY');
    });

    it('is stale when lighthouse fails but the html checks passed', async () => {
      const failing: typeof runLighthouse = async () => ({
        status: 'unavailable',
        kind: 'audit',
        meta: { durationMs: 10, at: new Date().toISOString() },
        error: { code: 'chrome_missing', message: 'Chrome is not installed.' },
      });

      const result = await audit('/good', {
        skipLighthouse: false,
        runLighthouseFn: failing,
      });

      expect(result.status).toBe('stale');
      // The audit wraps the underlying cause so the UI can show one message,
      // and names the component that degraded rather than echoing Chrome's code.
      expect(result.error?.code).toBe('lighthouse_unavailable');
      expect(result.error?.message).toContain('performance numbers');
      expect(result.meta.degradedBy).toContain('lighthouse');
      // The HTML findings are still real and still usable.
      expect(result.value?.checks).toHaveLength(8);
      expect(result.value?.metrics).toEqual({});
    });
  });

  it('lists every fixture site through the index page', async () => {
    const indexed = await startFixtureServer(undefined, { index: INDEX_SITE });
    try {
      const result = await auditWebsite(
        { websiteUrl: indexed.url('/') },
        {
          timeoutMs: 2000,
          reportDir,
          skipLighthouse: true,
          fetchOptions: { resolver: fixtureResolver },
        },
      );
      // Stale because Lighthouse was skipped, as above.
      expect(result.status).toBe('stale');
      expect(result.value?.checks.length).toBe(8);
    } finally {
      await indexed.close();
    }
  });
});
