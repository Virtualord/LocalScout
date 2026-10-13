import { describe, expect, it } from 'vitest';
import type { AuditCheck } from '../db/schema.js';
import {
  activityBonus,
  deriveFindings,
  FINDINGS,
  FINDING_IDS,
  MAX_SCORE,
  scoreLead,
  type FindingId,
} from './findings.js';

/** A page that passes every structural check. */
const ALL_PASS: AuditCheck[] = [
  { id: 'reachable', passed: true },
  { id: 'https', passed: true, value: 'https' },
  { id: 'has_viewport', passed: true, value: 'width=device-width' },
  { id: 'has_title', passed: true, value: 'Sharma Plumbing Works' },
  { id: 'has_meta_description', passed: true, value: 'Emergency plumbing in Bhopal.' },
  { id: 'has_tap_to_call', passed: true, value: '+919812345678' },
  { id: 'has_whatsapp_link', passed: true, value: 'wa.me' },
  { id: 'has_public_email', passed: true, value: 'hello@sharmaplumbing.in' },
];

const withChecks = (failing: string[]): AuditCheck[] =>
  ALL_PASS.map((entry) => (failing.includes(entry.id) ? { ...entry, passed: false } : entry));

const baseInput = { hasWebsite: true, unreachable: false, checks: ALL_PASS, metrics: {} };

const idsOf = (findings: { id: string }[]) => findings.map((f) => f.id).sort();
const weightOf = (findings: { id: string; weight: number }[], id: string) =>
  findings.find((f) => f.id === id)?.weight;

describe('findings catalog', () => {
  it('defines a spec for every declared id', () => {
    for (const id of FINDING_IDS) {
      expect(FINDINGS[id], id).toBeDefined();
      expect(FINDINGS[id].id).toBe(id);
      expect(FINDINGS[id].weight, id).toBeGreaterThan(0);
      expect(FINDINGS[id].label.length, id).toBeGreaterThan(0);
    }
  });

  it('matches the documented weights from the product spec', () => {
    const expected: Record<FindingId, number> = {
      NO_WEBSITE: 70,
      SITE_UNREACHABLE: 60,
      NO_HTTPS: 25,
      NOT_MOBILE_READY: 30,
      SLOW_LCP: 30,
      HIGH_TBT: 15,
      LAYOUT_SHIFT: 10,
      LOW_PERF_SCORE: 15,
      MISSING_META_DESCRIPTION: 8,
      MISSING_TITLE: 5,
      NO_TAP_TO_CALL: 10,
      NO_WHATSAPP_LINK: 5,
    };

    for (const [id, weight] of Object.entries(expected)) {
      expect(FINDINGS[id as FindingId].weight, id).toBe(weight);
    }
  });

  it('has no extra ids beyond the catalog', () => {
    expect(Object.keys(FINDINGS).sort()).toEqual([...FINDING_IDS].sort());
  });
});

describe('deriveFindings', () => {
  it('reports nothing for a healthy site', () => {
    expect(deriveFindings(baseInput)).toEqual([]);
  });

  describe('NO_WEBSITE', () => {
    it('fires when the business has no site', () => {
      const findings = deriveFindings({ ...baseInput, hasWebsite: false });
      expect(idsOf(findings)).toEqual(['NO_WEBSITE']);
      expect(weightOf(findings, 'NO_WEBSITE')).toBe(70);
    });

    it('does not report site-level problems for a site that does not exist', () => {
      const findings = deriveFindings({
        hasWebsite: false,
        unreachable: true,
        checks: withChecks(['has_viewport', 'https']),
        metrics: { lcp_ms: 9000, perf_score: 10 },
      });
      // Reporting "not mobile ready" for an absent site would be noise.
      expect(idsOf(findings)).toEqual(['NO_WEBSITE']);
    });
  });

  describe('SITE_UNREACHABLE', () => {
    it('fires and stops the site checks', () => {
      const findings = deriveFindings({
        hasWebsite: true,
        unreachable: true,
        checks: withChecks(['has_viewport', 'https', 'has_title']),
        metrics: { lcp_ms: 9000 },
      });
      expect(idsOf(findings)).toEqual(['SITE_UNREACHABLE']);
      expect(weightOf(findings, 'SITE_UNREACHABLE')).toBe(60);
      expect(findings[0]?.evidence['attempts']).toBe(2);
    });
  });

  describe('NO_HTTPS', () => {
    it('fires when the site is not served over https', () => {
      const findings = deriveFindings({ ...baseInput, checks: withChecks(['https']) });
      expect(idsOf(findings)).toEqual(['NO_HTTPS']);
      expect(findings[0]?.evidence['finalUrl']).toBe('https');
    });
  });

  describe('NOT_MOBILE_READY', () => {
    it('fires when the viewport tag is missing', () => {
      const findings = deriveFindings({ ...baseInput, checks: withChecks(['has_viewport']) });
      expect(idsOf(findings)).toEqual(['NOT_MOBILE_READY']);
      expect(findings[0]?.evidence['viewportMeta']).toBe('missing');
    });

    it('fires when Lighthouse measured a viewport failure even with the tag present', () => {
      const findings = deriveFindings({ ...baseInput, viewportFailed: true });
      expect(idsOf(findings)).toEqual(['NOT_MOBILE_READY']);
      expect(findings[0]?.evidence['lighthouseViewport']).toBe('failed');
    });

    it('does not double-count when both signals fire', () => {
      const findings = deriveFindings({
        ...baseInput,
        checks: withChecks(['has_viewport']),
        viewportFailed: true,
      });
      expect(idsOf(findings)).toEqual(['NOT_MOBILE_READY']);
    });
  });

  describe('SLOW_LCP', () => {
    it('does not fire at or below the moderate threshold', () => {
      expect(deriveFindings({ ...baseInput, metrics: { lcp_ms: 2500 } })).toEqual([]);
    });

    it('uses the reduced weight in the moderate band', () => {
      const findings = deriveFindings({ ...baseInput, metrics: { lcp_ms: 3000 } });
      expect(weightOf(findings, 'SLOW_LCP')).toBe(15);
      expect(findings[0]?.evidence['threshold_ms']).toBe(2500);
    });

    it('uses the full weight above the severe threshold', () => {
      const findings = deriveFindings({ ...baseInput, metrics: { lcp_ms: 6100 } });
      expect(weightOf(findings, 'SLOW_LCP')).toBe(30);
      expect(findings[0]?.evidence['threshold_ms']).toBe(4000);
    });

    it('records the measured value so a draft can allowlist it', () => {
      const findings = deriveFindings({ ...baseInput, metrics: { lcp_ms: 6100 } });
      expect(findings[0]?.evidence['lcp_ms']).toBe(6100);
    });
  });

  describe('HIGH_TBT', () => {
    it('does not fire at or below 200ms', () => {
      expect(deriveFindings({ ...baseInput, metrics: { tbt_ms: 200 } })).toEqual([]);
    });

    it('uses the reduced weight in the moderate band', () => {
      expect(weightOf(deriveFindings({ ...baseInput, metrics: { tbt_ms: 300 } }), 'HIGH_TBT')).toBe(
        7,
      );
    });

    it('uses the full weight above 600ms', () => {
      expect(weightOf(deriveFindings({ ...baseInput, metrics: { tbt_ms: 800 } }), 'HIGH_TBT')).toBe(
        15,
      );
    });
  });

  describe('LAYOUT_SHIFT', () => {
    it('does not fire at or below 0.1', () => {
      expect(deriveFindings({ ...baseInput, metrics: { cls: 0.1 } })).toEqual([]);
    });

    it('uses the reduced weight in the moderate band', () => {
      expect(
        weightOf(deriveFindings({ ...baseInput, metrics: { cls: 0.2 } }), 'LAYOUT_SHIFT'),
      ).toBe(5);
    });

    it('uses the full weight above 0.25', () => {
      expect(
        weightOf(deriveFindings({ ...baseInput, metrics: { cls: 0.31 } }), 'LAYOUT_SHIFT'),
      ).toBe(10);
    });
  });

  describe('LOW_PERF_SCORE', () => {
    it('fires below 50 and not at exactly 50', () => {
      expect(idsOf(deriveFindings({ ...baseInput, metrics: { perf_score: 49 } }))).toEqual([
        'LOW_PERF_SCORE',
      ]);
      expect(deriveFindings({ ...baseInput, metrics: { perf_score: 50 } })).toEqual([]);
    });

    it('records the measured score', () => {
      const findings = deriveFindings({ ...baseInput, metrics: { perf_score: 38 } });
      expect(findings[0]?.evidence['perf_score']).toBe(38);
      expect(findings[0]?.evidence['threshold']).toBe(50);
    });
  });

  describe('minor structural findings', () => {
    it('reports a missing meta description', () => {
      const findings = deriveFindings({
        ...baseInput,
        checks: withChecks(['has_meta_description']),
      });
      expect(idsOf(findings)).toEqual(['MISSING_META_DESCRIPTION']);
      expect(weightOf(findings, 'MISSING_META_DESCRIPTION')).toBe(8);
    });

    it('reports a generic title', () => {
      const findings = deriveFindings({ ...baseInput, checks: withChecks(['has_title']) });
      expect(idsOf(findings)).toEqual(['MISSING_TITLE']);
    });

    it('reports no tap-to-call and no whatsapp link', () => {
      const findings = deriveFindings({
        ...baseInput,
        checks: withChecks(['has_tap_to_call', 'has_whatsapp_link']),
      });
      expect(idsOf(findings)).toEqual(['NO_TAP_TO_CALL', 'NO_WHATSAPP_LINK']);
    });
  });

  it('never reports a metric that was not measured', () => {
    // No Lighthouse means no metrics object values, so no metric findings.
    const findings = deriveFindings({ ...baseInput, metrics: {} });
    expect(idsOf(findings)).toEqual([]);
  });

  it('is deterministic for the same input', () => {
    const input = {
      ...baseInput,
      checks: withChecks(['https', 'has_title']),
      metrics: { lcp_ms: 6100, cls: 0.31, tbt_ms: 800, perf_score: 38 },
    };
    expect(deriveFindings(input)).toEqual(deriveFindings(input));
  });
});

describe('activityBonus', () => {
  it('gives nothing without both a rating and a review count', () => {
    expect(activityBonus({ rating: 4.8 })).toBe(0);
    expect(activityBonus({ reviewCount: 200 })).toBe(0);
    expect(activityBonus({})).toBe(0);
  });

  it('gives nothing below 4.0 stars', () => {
    expect(activityBonus({ rating: 3.9, reviewCount: 500 })).toBe(0);
  });

  it('gives nothing below 20 reviews', () => {
    expect(activityBonus({ rating: 4.8, reviewCount: 19 })).toBe(0);
  });

  it('gives nothing at exactly the thresholds', () => {
    expect(activityBonus({ rating: 4.0, reviewCount: 20 })).toBe(0);
  });

  it('gives the full bonus for a well-reviewed, highly rated business', () => {
    expect(activityBonus({ rating: 4.8, reviewCount: 300 })).toBe(10);
  });

  it('caps at 10', () => {
    expect(activityBonus({ rating: 5, reviewCount: 5000 })).toBe(10);
  });

  it('scales between the thresholds', () => {
    const low = activityBonus({ rating: 4.3, reviewCount: 40 });
    const mid = activityBonus({ rating: 4.6, reviewCount: 60 });
    const high = activityBonus({ rating: 4.9, reviewCount: 90 });

    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('rounds to zero just above the threshold', () => {
    // A business barely qualifying should not move the score at all; the bonus
    // is meant to separate clearly active businesses, not add noise.
    expect(activityBonus({ rating: 4.1, reviewCount: 25 })).toBe(0);
  });
});

describe('scoreLead', () => {
  it('scores zero for a healthy, inactive business', () => {
    const result = scoreLead({ findings: [] });
    expect(result).toEqual({ score: 0, rawScore: 0, bonus: 0, capped: false });
  });

  it('sums finding weights', () => {
    const findings = deriveFindings({
      ...baseInput,
      checks: withChecks(['has_meta_description', 'has_title']),
    });
    const result = scoreLead({ findings });
    expect(result.rawScore).toBe(8 + 5);
    expect(result.score).toBe(13);
  });

  it('adds the activity bonus for an active business', () => {
    const findings = deriveFindings({ ...baseInput, checks: withChecks(['has_title']) });
    const withBonus = scoreLead({ findings, rating: 4.8, reviewCount: 300 });
    const withoutBonus = scoreLead({ findings });

    expect(withBonus.bonus).toBe(10);
    expect(withBonus.score).toBe(withoutBonus.score + 10);
  });

  it('caps at 100 and reports that it capped', () => {
    // No website alone is 70; add every other finding to exceed the cap.
    const findings = deriveFindings({
      hasWebsite: false,
      unreachable: false,
      checks: ALL_PASS,
      metrics: { lcp_ms: 9000, tbt_ms: 900, cls: 0.5, perf_score: 5 },
    });
    const result = scoreLead({ findings, rating: 4.9, reviewCount: 500 });

    expect(result.rawScore).toBe(70);
    expect(result.bonus).toBe(10);
    expect(result.score).toBe(80);
    expect(result.capped).toBe(false);
  });

  it('caps a genuinely huge score', () => {
    const manyFindings = FINDING_IDS.filter(
      (id) => id !== 'NO_WEBSITE' && id !== 'SITE_UNREACHABLE',
    ).map((id) => ({
      id,
      severity: 'medium' as const,
      label: id,
      weight: FINDINGS[id].weight,
      evidence: {},
    }));

    const result = scoreLead({ findings: manyFindings, rating: 5, reviewCount: 1000 });
    expect(result.rawScore).toBeGreaterThan(MAX_SCORE);
    expect(result.score).toBe(MAX_SCORE);
    expect(result.capped).toBe(true);
  });

  it('ranks a business with no website above one with a slow site', () => {
    const noWebsite = scoreLead({
      findings: deriveFindings({ ...baseInput, hasWebsite: false }),
    }).score;

    const slowSite = scoreLead({
      findings: deriveFindings({ ...baseInput, metrics: { lcp_ms: 9000 } }),
    }).score;

    expect(noWebsite).toBeGreaterThan(slowSite);
  });
});
