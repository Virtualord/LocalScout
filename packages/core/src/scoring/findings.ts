import type { AuditCheck, AuditMetrics, StoredFinding } from '../db/schema.js';

/**
 * The findings catalog.
 *
 * Every problem Localscout reports is one row here, with a trigger, the weight
 * it contributes to the opportunity score, and a plain-English label. Keeping
 * this as data rather than code means:
 *
 * - A scoring change is reviewable as a diff of numbers, not a refactor.
 * - The drafting layer can allowlist exactly the numbers a finding was measured
 *   against, so a draft cannot quote a figure nothing measured.
 * - Adding a finding cannot silently change the meaning of an existing one.
 *
 * Weights express opportunity, not severity alone: a business with no website
 * scores far higher than one with a slow one, because the first is a clear,
 * uncontested piece of work and the second may already be handled.
 */

export type FindingId =
  | 'NO_WEBSITE'
  | 'SITE_UNREACHABLE'
  | 'NO_HTTPS'
  | 'NOT_MOBILE_READY'
  | 'SLOW_LCP'
  | 'HIGH_TBT'
  | 'LAYOUT_SHIFT'
  | 'LOW_PERF_SCORE'
  | 'MISSING_META_DESCRIPTION'
  | 'MISSING_TITLE'
  | 'NO_TAP_TO_CALL'
  | 'NO_WHATSAPP_LINK';

export const FINDING_IDS: readonly FindingId[] = [
  'NO_WEBSITE',
  'SITE_UNREACHABLE',
  'NO_HTTPS',
  'NOT_MOBILE_READY',
  'SLOW_LCP',
  'HIGH_TBT',
  'LAYOUT_SHIFT',
  'LOW_PERF_SCORE',
  'MISSING_META_DESCRIPTION',
  'MISSING_TITLE',
  'NO_TAP_TO_CALL',
  'NO_WHATSAPP_LINK',
];

export type Severity = 'high' | 'medium' | 'low';

export interface FindingSpec {
  id: FindingId;
  /** Full weight, applied at the severe end of the trigger. */
  weight: number;
  /**
   * Reduced weight when the trigger only moderately fired.
   *
   * Present only for the graded findings. Set explicitly rather than as a
   * multiplier of `weight` so the table can be read against the product spec
   * directly, which is the point of keeping it as data.
   */
  moderateWeight?: number;
  severity: Severity;
  /** Plain-English description shown to the user. */
  label: string;
}

/**
 * The catalog.
 *
 * Thresholds live with the trigger functions below rather than here, because a
 * threshold is only meaningful next to the measurement it compares against.
 */
export const FINDINGS: Record<FindingId, FindingSpec> = {
  NO_WEBSITE: {
    id: 'NO_WEBSITE',
    weight: 70,
    severity: 'high',
    label: 'No website of its own',
  },
  SITE_UNREACHABLE: {
    id: 'SITE_UNREACHABLE',
    weight: 60,
    severity: 'high',
    label: 'Website does not load',
  },
  NO_HTTPS: {
    id: 'NO_HTTPS',
    weight: 25,
    severity: 'medium',
    label: 'Not served over HTTPS',
  },
  NOT_MOBILE_READY: {
    id: 'NOT_MOBILE_READY',
    weight: 30,
    severity: 'high',
    label: 'Not usable on a phone',
  },
  SLOW_LCP: {
    id: 'SLOW_LCP',
    weight: 30,
    moderateWeight: 15,
    severity: 'high',
    label: 'Slow to show main content',
  },
  HIGH_TBT: {
    id: 'HIGH_TBT',
    weight: 15,
    moderateWeight: 7,
    severity: 'medium',
    label: 'Page blocks interaction',
  },
  LAYOUT_SHIFT: {
    id: 'LAYOUT_SHIFT',
    weight: 10,
    moderateWeight: 5,
    severity: 'low',
    label: 'Content jumps while loading',
  },
  LOW_PERF_SCORE: {
    id: 'LOW_PERF_SCORE',
    weight: 15,
    severity: 'medium',
    label: 'Low Lighthouse performance score',
  },
  MISSING_META_DESCRIPTION: {
    id: 'MISSING_META_DESCRIPTION',
    weight: 8,
    severity: 'low',
    label: 'No meta description for search results',
  },
  MISSING_TITLE: { id: 'MISSING_TITLE', weight: 5, severity: 'low', label: 'Generic page title' },
  NO_TAP_TO_CALL: {
    id: 'NO_TAP_TO_CALL',
    weight: 10,
    severity: 'medium',
    label: 'No tap-to-call button',
  },
  NO_WHATSAPP_LINK: {
    id: 'NO_WHATSAPP_LINK',
    weight: 5,
    severity: 'low',
    label: 'No WhatsApp button on the site',
  },
};

/**
 * Half-weights applied when a metric is only moderately out of range.
 *
 * A site at 3000 ms LCP has a real problem but a much smaller opening than one
 * at 9000 ms, so the severe thresholds have a graded lower band. The reduced
 * values live in the catalog as `moderateWeight`.
 */
const LCP_SEVERE_MS = 4000;
const LCP_MODERATE_MS = 2500;
const TBT_SEVERE_MS = 600;
const TBT_MODERATE_MS = 200;
const CLS_SEVERE = 0.25;
const CLS_MODERATE = 0.1;
const PERF_SCORE_LOW = 50;

export interface FindingInput {
  /** The lead has no site of its own (absent, or only a social/directory page). */
  hasWebsite: boolean;
  /** The site was attempted twice and failed both times. */
  unreachable: boolean;
  checks: AuditCheck[];
  metrics: AuditMetrics;
  /** True when Lighthouse's own viewport audit failed. */
  viewportFailed?: boolean | undefined;
}

const checkPassed = (checks: AuditCheck[], id: string): boolean =>
  checks.find((entry) => entry.id === id)?.passed === true;

/**
 * Derive every finding that applies, with its evidence.
 *
 * Pure and table-tested: no I/O, no clock, no randomness. The same inputs
 * always produce the same findings, which is what lets the grounding validator
 * trust the numbers in a draft.
 */
export function deriveFindings(input: FindingInput): StoredFinding[] {
  const findings: StoredFinding[] = [];
  const push = (
    id: FindingId,
    evidence: Record<string, string | number | boolean>,
    moderate = false,
  ) => {
    const spec = FINDINGS[id];
    // A moderately-fired graded finding carries the catalog's reduced weight,
    // so the score reflects how bad the measurement actually was.
    const weight =
      moderate && spec.moderateWeight !== undefined ? spec.moderateWeight : spec.weight;
    findings.push({
      id: spec.id,
      severity: spec.severity,
      label: spec.label,
      weight,
      evidence,
    });
  };

  // A lead with no site short-circuits the site-level checks: reporting "not
  // mobile ready" for a site that does not exist would be noise.
  if (!input.hasWebsite) {
    push('NO_WEBSITE', { website: 'none', source: 'google_maps_listing' });
    return findings;
  }

  if (input.unreachable) {
    push('SITE_UNREACHABLE', { attempts: 2, result: 'no_response' });
    // The remaining checks never ran, so reporting them would be inventing them.
    return findings;
  }

  if (!checkPassed(input.checks, 'https')) {
    push('NO_HTTPS', { finalUrl: schemeOf(input.checks), threshold: 'https' });
  }

  // Either signal is enough: a missing viewport tag, or Lighthouse measuring
  // that the page is unusable at a mobile width.
  const viewportMissing = !checkPassed(input.checks, 'has_viewport');
  if (viewportMissing || input.viewportFailed === true) {
    push('NOT_MOBILE_READY', {
      viewportMeta: viewportMissing ? 'missing' : 'present',
      lighthouseViewport: input.viewportFailed === true ? 'failed' : 'passed',
    });
  }

  const { lcp_ms: lcp, tbt_ms: tbt, cls, perf_score: perf } = input.metrics;

  if (lcp !== undefined) {
    if (lcp > LCP_SEVERE_MS) {
      push('SLOW_LCP', { lcp_ms: lcp, threshold_ms: LCP_SEVERE_MS, unit: 'ms' });
    } else if (lcp > LCP_MODERATE_MS) {
      push(
        'SLOW_LCP',
        { lcp_ms: lcp, threshold_ms: LCP_MODERATE_MS, unit: 'ms', severityNote: 'moderate' },
        true,
      );
    }
  }

  if (tbt !== undefined) {
    if (tbt > TBT_SEVERE_MS) {
      push('HIGH_TBT', { tbt_ms: tbt, threshold_ms: TBT_SEVERE_MS, unit: 'ms' });
    } else if (tbt > TBT_MODERATE_MS) {
      push(
        'HIGH_TBT',
        { tbt_ms: tbt, threshold_ms: TBT_MODERATE_MS, unit: 'ms', severityNote: 'moderate' },
        true,
      );
    }
  }

  if (cls !== undefined) {
    if (cls > CLS_SEVERE) {
      push('LAYOUT_SHIFT', { cls, threshold: CLS_SEVERE });
    } else if (cls > CLS_MODERATE) {
      push('LAYOUT_SHIFT', { cls, threshold: CLS_MODERATE, severityNote: 'moderate' }, true);
    }
  }

  if (perf !== undefined && perf < PERF_SCORE_LOW) {
    push('LOW_PERF_SCORE', { perf_score: perf, threshold: PERF_SCORE_LOW, unit: 'points' });
  }

  if (!checkPassed(input.checks, 'has_meta_description')) {
    push('MISSING_META_DESCRIPTION', { present: false });
  }

  if (!checkPassed(input.checks, 'has_title')) {
    push('MISSING_TITLE', { present: false });
  }

  if (!checkPassed(input.checks, 'has_tap_to_call')) {
    push('NO_TAP_TO_CALL', { present: false });
  }

  if (!checkPassed(input.checks, 'has_whatsapp_link')) {
    push('NO_WHATSAPP_LINK', { present: false });
  }

  return findings;
}

function schemeOf(checks: AuditCheck[]): string {
  const https = checks.find((entry) => entry.id === 'https');
  return typeof https?.value === 'string' ? https.value : 'unknown';
}

/**
 * Bonus for a business that is clearly active.
 *
 * A business with good reviews and a high rating is one that is open and
 * spending, so a worse site is a more real opportunity. Capped at 10 so it can
 * never outrank a missing website.
 */
export function activityBonus(input: {
  rating?: number | undefined;
  reviewCount?: number | undefined;
}): number {
  const rating = input.rating;
  const reviews = input.reviewCount;

  if (rating === undefined || reviews === undefined) return 0;
  if (rating < 4.0) return 0;
  if (reviews < 20) return 0;

  // Full bonus at 4.5 stars or better with 100+ reviews.
  const ratingPart = Math.min(1, (rating - 4.0) / 0.5);
  const reviewPart = Math.min(1, (reviews - 20) / 80);
  return Math.round(ratingPart * reviewPart * 10);
}

export interface ScoreInput {
  findings: StoredFinding[];
  rating?: number | undefined;
  reviewCount?: number | undefined;
}

export interface ScoreResult {
  /** 0-100, capped. */
  score: number;
  /** Sum of finding weights before the cap, for debugging. */
  rawScore: number;
  /** Activity bonus applied, 0-10. */
  bonus: number;
  /** True when the cap actually bound. */
  capped: boolean;
}

export const MAX_SCORE = 100;

/**
 * Opportunity score.
 *
 * A bad site on an active business is a good lead; a bad site on a dormant one
 * is not, which is the whole reason the activity bonus exists.
 */
export function scoreLead(input: ScoreInput): ScoreResult {
  const rawScore = input.findings.reduce((total, finding) => total + finding.weight, 0);
  const bonus = activityBonus({ rating: input.rating, reviewCount: input.reviewCount });
  const uncapped = rawScore + bonus;
  const score = Math.min(MAX_SCORE, uncapped);

  return { score, rawScore, bonus, capped: uncapped > MAX_SCORE };
}
