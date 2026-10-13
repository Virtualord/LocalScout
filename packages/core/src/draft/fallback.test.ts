import { describe, expect, it } from 'vitest';
import type { StoredFinding } from '../db/schema.js';
import { buildFallbackDraft, type SenderProfile } from './fallback.js';
import { validateGrounding } from './grounding.js';
import type { Language } from '../db/schema.js';

const sender: SenderProfile = {
  name: 'Aditya',
  portfolioUrl: 'https://aditya.example/',
  services: 'fast, mobile-friendly websites',
};

const slowLcp: StoredFinding = {
  id: 'SLOW_LCP',
  severity: 'high',
  label: 'Slow to show main content',
  weight: 30,
  evidence: { lcp_ms: 6100, threshold_ms: 4000, unit: 'ms' },
};

const noWebsite: StoredFinding = {
  id: 'NO_WEBSITE',
  severity: 'high',
  label: 'No website of its own',
  weight: 70,
  evidence: { website: 'none', source: 'google_maps_listing' },
};

const noViewport: StoredFinding = {
  id: 'NOT_MOBILE_READY',
  severity: 'high',
  label: 'Not usable on a phone',
  weight: 30,
  evidence: { viewportMeta: 'missing', lighthouseViewport: 'passed' },
};

const languages: Language[] = ['en', 'hinglish', 'hi'];

const build = (findings: StoredFinding[], language: Language) =>
  buildFallbackDraft({ businessName: 'Sharma Plumbing', findings, language, sender });

describe('fallback templates', () => {
  describe('produce a grounded draft in every language', () => {
    it.each(languages)('%s with measured findings', (language) => {
      const findings = [slowLcp, noViewport];
      const draft = build(findings, language);

      const result = validateGrounding(draft, {
        findings,
        websiteUrl: 'https://sharmaplumbing.in/',
        portfolioUrl: sender.portfolioUrl,
      });

      // The whole point of the fallback: usable without a retry, and provably
      // grounded against the same validator a model draft must pass.
      expect(result.errors).toEqual([]);
      expect(result.grounded).toBe(true);
    });

    it.each(languages)('%s with no website', (language) => {
      const findings = [noWebsite];
      const draft = build(findings, language);

      // The portfolio must be in the grounding context whenever the draft may
      // reference it, which is exactly how the orchestrator calls this.
      const result = validateGrounding(draft, { findings, portfolioUrl: sender.portfolioUrl });
      expect(result.grounded, JSON.stringify(result.errors)).toBe(true);
    });

    it.each(languages)('%s with no findings at all', (language) => {
      const draft = build([], language);
      // Nothing was measured, so nothing may be claimed.
      expect(draft.used_finding_ids).toEqual([]);
      expect(draft.whatsapp.length).toBeGreaterThan(0);
      expect(
        validateGrounding(draft, { findings: [], portfolioUrl: sender.portfolioUrl }).grounded,
      ).toBe(true);
    });
  });

  describe('no-website family', () => {
    it.each(languages)('says it could not find a website (%s)', (language) => {
      const draft = build([noWebsite], language);
      if (language === 'en') expect(draft.whatsapp).toContain('could not find');
      if (language === 'hinglish') expect(draft.whatsapp).toContain('nahi mili');
      if (language === 'hi') expect(draft.whatsapp).toContain('नहीं मिली');
    });

    it.each(languages)('does not claim anything about site quality (%s)', (language) => {
      const draft = build([noWebsite], language);
      for (const forbidden of ['seconds', 'score', 'seconds', 'सेकंड', 'स्कोर']) {
        if (forbidden === 'seconds') {
          expect(draft.whatsapp.toLowerCase()).not.toContain('second');
        }
        if (forbidden === 'सेकंड') expect(draft.whatsapp).not.toContain('सेकंड');
        if (forbidden === 'स्कोर') expect(draft.whatsapp).not.toContain('स्कोर');
      }
    });

    it('names the business and the sender', () => {
      const draft = build([noWebsite], 'en');
      expect(draft.whatsapp).toContain('Sharma Plumbing');
      expect(draft.whatsapp).toContain('Aditya');
    });
  });

  describe('cites at most three findings', () => {
    it('caps the citation list', () => {
      const many: StoredFinding[] = [
        slowLcp,
        noViewport,
        {
          id: 'NO_HTTPS',
          severity: 'medium',
          label: 'Not https',
          weight: 25,
          evidence: { finalUrl: 'http' },
        },
        {
          id: 'HIGH_TBT',
          severity: 'medium',
          label: 'Blocking time',
          weight: 15,
          evidence: { tbt_ms: 800, unit: 'ms' },
        },
      ];

      const draft = build(many, 'en');
      expect(draft.used_finding_ids).toHaveLength(3);
    });

    it('leads with the most important finding', () => {
      const draft = build([noViewport, slowLcp], 'en');
      expect(draft.used_finding_ids[0]).toBe('SLOW_LCP');
    });

    it('orders by priority, not by input order', () => {
      const draft = build(
        [{ id: 'MISSING_TITLE', severity: 'low', label: 't', weight: 5, evidence: {} }, noViewport],
        'en',
      );
      expect(draft.used_finding_ids[0]).toBe('NOT_MOBILE_READY');
    });
  });

  describe('only cites findings that exist', () => {
    it('reports exactly the findings it mentioned', () => {
      const findings = [slowLcp, noViewport];
      const draft = build(findings, 'en');
      expect(draft.used_finding_ids.sort()).toEqual(['NOT_MOBILE_READY', 'SLOW_LCP']);
    });
  });

  describe('measured values', () => {
    it('states the LCP in seconds, not milliseconds', () => {
      const draft = build([slowLcp], 'en');
      expect(draft.whatsapp).toContain('6.1');
      // 6100 ms should never be quoted raw to a business owner.
      expect(draft.whatsapp).not.toContain('6100');
    });

    it('falls back to the label when the value was not measured', () => {
      const unmeasured: StoredFinding = {
        id: 'SLOW_LCP',
        severity: 'high',
        label: 'Slow to show main content',
        weight: 30,
        evidence: {},
      };
      const draft = build([unmeasured], 'en');
      expect(draft.whatsapp).toContain('Slow to show main content');
      expect(draft.whatsapp).not.toContain('undefined');
    });

    it('never prints undefined anywhere', () => {
      const draft = build([slowLcp, noViewport, noWebsite], 'en');
      expect(draft.whatsapp).not.toContain('undefined');
      expect(draft.email_body).not.toContain('undefined');
    });
  });

  describe('tone and required elements', () => {
    it.each(languages)('includes an opt-out line (%s)', (language) => {
      const draft = build([slowLcp], language);
      if (language === 'en') expect(draft.whatsapp).toContain('STOP');
      if (language === 'hinglish') expect(draft.whatsapp).toContain('STOP');
      if (language === 'hi') expect(draft.whatsapp).toContain('STOP');
    });

    it.each(languages)('offers one low-pressure next step (%s)', (language) => {
      const draft = build([slowLcp], language);
      if (language === 'en') expect(draft.whatsapp).toContain('free audit report');
      if (language === 'hinglish') expect(draft.whatsapp).toContain('audit report');
      if (language === 'hi') expect(draft.whatsapp).toContain('ऑडिट रिपोर्ट');
    });

    it.each(languages)('avoids banned phrases (%s)', (language) => {
      const draft = build([slowLcp], language);
      const lowered = draft.whatsapp.toLowerCase();
      for (const phrase of ['guaranteed', 'act now', '#1', 'best in']) {
        expect(lowered, `${language}: ${phrase}`).not.toContain(phrase);
      }
    });

    it.each(languages)('keeps the whatsapp message under the limit (%s)', (language) => {
      const draft = build([slowLcp, noViewport], language);
      expect(draft.whatsapp.length).toBeLessThanOrEqual(450);
    });

    it('includes the portfolio link when one is configured', () => {
      const draft = build([slowLcp], 'en');
      expect(draft.whatsapp).toContain('aditya.example');
    });

    it('omits the portfolio line when none is configured', () => {
      const draft = buildFallbackDraft({
        businessName: 'Sharma Plumbing',
        findings: [slowLcp],
        language: 'en',
        sender: { name: 'Aditya', services: 'websites' },
      });
      expect(draft.whatsapp).not.toContain('http');
      expect(validateGrounding(draft, { findings: [slowLcp] }).grounded).toBe(true);
    });
  });

  describe('determinism', () => {
    it.each(languages)('produces identical output for identical input (%s)', (language) => {
      const findings = [slowLcp, noViewport];
      expect(build(findings, language)).toEqual(build(findings, language));
    });

    it('does not mutate the findings it was given', () => {
      const findings = [noViewport, slowLcp];
      const snapshot = JSON.stringify(findings);
      build(findings, 'en');
      expect(JSON.stringify(findings)).toBe(snapshot);
    });
  });

  it('produces an email body and subject in every language', () => {
    for (const language of languages) {
      const draft = build([slowLcp], language);
      expect(draft.email_subject.length).toBeGreaterThan(0);
      expect(draft.email_body.length).toBeGreaterThan(0);
    }
  });

  it('writes hinglish in roman script, not devanagari', () => {
    const draft = build([slowLcp], 'hinglish');
    expect(draft.whatsapp).toMatch(/^[\x20-\x7E]*$/);
  });

  it('writes hindi in devanagari', () => {
    const draft = build([slowLcp], 'hi');
    expect(draft.whatsapp).toMatch(/[ऀ-ॿ]/);
  });
});
