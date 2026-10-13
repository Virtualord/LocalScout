import { describe, expect, it } from 'vitest';
import type { StoredFinding } from '../db/schema.js';
import { buildNumberAllowlist, extractNumbers, validateGrounding } from './grounding.js';
import type { DraftOutput } from './provider.js';

const finding = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  id: 'SLOW_LCP',
  severity: 'high',
  label: 'Slow to show main content',
  weight: 30,
  evidence: { lcp_ms: 6100, threshold_ms: 4000, unit: 'ms' },
  ...over,
});

const slowLcp: StoredFinding = finding();

const draft = (over: Partial<DraftOutput> = {}): DraftOutput => ({
  whatsapp:
    'Namaste, I ran a mobile speed test on your site and it took 6.1 seconds to show the main content.',
  email_subject: 'Your site took 6.1 seconds to load on mobile',
  email_body:
    'I ran a mobile speed test on your site and the main content took 6.1 seconds to appear. That is slower than most sites. If you want, I can send a free audit report with the details.',
  used_finding_ids: ['SLOW_LCP'],
  ...over,
});

const context = { findings: [slowLcp] };

describe('extractNumbers', () => {
  it('pulls plain integers', () => {
    expect(extractNumbers('took 6100 ms')).toEqual(['6100']);
  });

  it('handles thousands separators', () => {
    expect(extractNumbers('6,100 milliseconds')).toEqual(['6100']);
  });

  it('handles decimals', () => {
    expect(extractNumbers('CLS was 0.31')).toEqual(['0.31']);
  });

  it('handles a trailing unit', () => {
    expect(extractNumbers('about 6.1s to load')).toEqual(['6.1']);
  });

  it('handles percentages', () => {
    expect(extractNumbers('38% score')).toEqual(['38']);
  });

  it('normalizes trailing zeros so 0.30 and 0.3 compare equal', () => {
    expect(extractNumbers('0.30')).toEqual(['0.3']);
  });

  it('returns nothing for text without numbers', () => {
    expect(extractNumbers('no numbers here')).toEqual([]);
  });

  it('handles several numbers in one string', () => {
    expect(extractNumbers('LCP 6100 ms and CLS 0.31')).toEqual(['6100', '0.31']);
  });
});

describe('buildNumberAllowlist', () => {
  it('includes every measured value and its renderings', () => {
    const allowed = buildNumberAllowlist(context);
    expect(allowed.has('6100')).toBe(true);
    expect(allowed.has('6.1')).toBe(true);
    expect(allowed.has('4000')).toBe(true);
  });

  it('includes the category score as written', () => {
    const allowed = buildNumberAllowlist({ findings: [finding({ evidence: { perf_score: 38 } })] });
    expect(allowed.has('38')).toBe(true);
    expect(allowed.has('39')).toBe(false);
  });

  it('includes explicit extra numbers', () => {
    const allowed = buildNumberAllowlist({ findings: [], allowedNumbers: ['4.5', '120'] });
    expect(allowed.has('4.5')).toBe(true);
    expect(allowed.has('120')).toBe(true);
  });

  it('does not allow arbitrary numbers', () => {
    expect(buildNumberAllowlist(context).has('9999')).toBe(false);
  });
});

describe('validateGrounding', () => {
  describe('accepts an honest draft', () => {
    it('passes a grounded draft that cites a real finding', () => {
      const result = validateGrounding(draft(), context);
      expect(result.errors).toEqual([]);
      expect(result.grounded).toBe(true);
    });

    it('accepts a draft with no numbers at all', () => {
      const result = validateGrounding(
        draft({
          whatsapp:
            'Namaste, I checked your site and it takes a while to load on a phone. Want a free audit report?',
          email_subject: 'A quick note about your website',
          email_body:
            'I checked your site and found a loading problem on phones. Happy to send a free report.',
          used_finding_ids: ['SLOW_LCP'],
        }),
        context,
      );
      expect(result.grounded).toBe(true);
    });

    it('accepts the measured value in any rendering', () => {
      for (const rendering of ['6100', '6.1', '6.10']) {
        const result = validateGrounding(
          draft({ whatsapp: `It took ${rendering} seconds to load.` }),
          context,
        );
        expect(result.grounded, rendering).toBe(true);
      }
    });

    it('accepts small counting numbers that are not claims', () => {
      const result = validateGrounding(
        draft({
          whatsapp: 'I ran 3 checks on your site. Want the free report?',
          email_subject: '3 things I noticed',
          email_body: 'I ran 3 checks and found one issue worth fixing.',
          used_finding_ids: [],
        }),
        { findings: [] },
      );
      expect(result.grounded).toBe(true);
    });
  });

  describe('rejects invented numbers', () => {
    it('rejects a fabricated metric', () => {
      const result = validateGrounding(
        draft({ whatsapp: 'Your site took 9.9 seconds to load.' }),
        context,
      );
      expect(result.grounded).toBe(false);
      expect(result.errors.map((e) => e.code)).toContain('invented_number');
    });

    it('rejects a fabricated customer claim', () => {
      const result = validateGrounding(
        draft({
          whatsapp: 'I can get you 50 more customers every month.',
          email_subject: '50 more customers',
          email_body: 'I can get you 50 more customers every month.',
          used_finding_ids: [],
        }),
        { findings: [] },
      );
      expect(result.errors.map((e) => e.code)).toContain('invented_number');
    });

    it('rejects a number that is close to but not the measured one', () => {
      const result = validateGrounding(
        draft({ whatsapp: 'It took 6.5 seconds to load.' }),
        context,
      );
      expect(result.grounded).toBe(false);
    });

    it('allows a number measured by a different finding', () => {
      const multi = [
        slowLcp,
        finding({ id: 'LOW_PERF_SCORE', evidence: { perf_score: 38, threshold: 50 } }),
      ];
      const result = validateGrounding(
        draft({ whatsapp: 'Lighthouse gave it a 38 out of 100 on mobile.' }),
        { findings: multi },
      );
      expect(result.grounded).toBe(true);
    });

    it('reports the offending number so a retry can fix it', () => {
      const result = validateGrounding(draft({ whatsapp: 'It took 9.9 seconds.' }), context);
      const error = result.errors.find((e) => e.code === 'invented_number');
      expect(error?.message).toContain('9.9');
    });
  });

  describe('rejects unknown finding citations', () => {
    it('rejects a finding the audit never produced', () => {
      const result = validateGrounding(
        draft({ used_finding_ids: ['SLOW_LCP', 'MADE_UP'] }),
        context,
      );
      expect(result.grounded).toBe(false);
      const error = result.errors.find((e) => e.code === 'unknown_finding_id');
      expect(error?.message).toContain('MADE_UP');
    });

    it('rejects citing only a finding that does not exist', () => {
      const result = validateGrounding(draft({ used_finding_ids: ['NO_WEBSITE'] }), context);
      expect(result.grounded).toBe(false);
    });

    it('accepts an empty citation list', () => {
      const result = validateGrounding(draft({ used_finding_ids: [] }), context);
      expect(result.grounded).toBe(true);
    });

    it('does not require every finding to be cited', () => {
      const result = validateGrounding(draft({ used_finding_ids: ['SLOW_LCP'] }), {
        findings: [slowLcp, finding({ id: 'MISSING_TITLE' })],
      });
      expect(result.grounded).toBe(true);
    });
  });

  describe('rejects foreign urls', () => {
    it('allows the lead own site', () => {
      const result = validateGrounding(
        draft({ whatsapp: 'I looked at https://sharmaplumbing.in for you.' }),
        { ...context, websiteUrl: 'https://sharmaplumbing.in/' },
      );
      expect(result.grounded).toBe(true);
    });

    it('allows the sender portfolio', () => {
      const result = validateGrounding(
        draft({ whatsapp: 'See https://mywork.example/case-studies' }),
        { ...context, portfolioUrl: 'https://mywork.example/' },
      );
      expect(result.grounded).toBe(true);
    });

    it('rejects an invented portfolio link', () => {
      const result = validateGrounding(
        draft({ whatsapp: 'Check https://someone-elses-portfolio.example/' }),
        { ...context, portfolioUrl: 'https://mywork.example/' },
      );
      expect(result.grounded).toBe(false);
      const error = result.errors.find((e) => e.code === 'foreign_url');
      expect(error?.message).toContain('someone-elses-portfolio.example');
    });

    it('rejects a link when no url is allowed at all', () => {
      const result = validateGrounding(draft({ whatsapp: 'Visit https://example.com' }), context);
      expect(result.grounded).toBe(false);
    });

    it('allows a www form of an allowed host', () => {
      const result = validateGrounding(draft({ whatsapp: 'See https://www.mywork.example/' }), {
        ...context,
        portfolioUrl: 'https://mywork.example/',
      });
      expect(result.grounded).toBe(true);
    });
  });

  describe('rejects banned phrases', () => {
    it.each([
      'We are the #1 on Google plumbers in Bhopal',
      'Guaranteed results',
      'Double your customers',
      'Act now',
      'Limited time offer',
    ])('rejects: %s', (phrase) => {
      const result = validateGrounding(draft({ whatsapp: phrase }), context);
      expect(result.grounded).toBe(false);
      expect(result.errors.map((e) => e.code)).toContain('banned_phrase');
    });

    it('is case insensitive', () => {
      const result = validateGrounding(draft({ whatsapp: 'GUARANTEED results for you' }), context);
      expect(result.grounded).toBe(false);
    });

    it('accepts a custom banned list', () => {
      const result = validateGrounding(draft({ whatsapp: 'We offer local service' }), context, {
        bannedPhrases: ['local service'],
      });
      expect(result.grounded).toBe(false);
    });

    it('does not flag ordinary phrasing', () => {
      const result = validateGrounding(
        draft({ whatsapp: 'I can send a free audit report if that helps.' }),
        context,
      );
      expect(result.grounded).toBe(true);
    });
  });

  describe('enforces length limits', () => {
    it('rejects an over-long whatsapp message', () => {
      const result = validateGrounding(draft({ whatsapp: 'a'.repeat(500) }), context);
      expect(result.errors.map((e) => e.code)).toContain('whatsapp_too_long');
    });

    it('accepts a message exactly at the limit', () => {
      const text = 'a'.repeat(450);
      const result = validateGrounding(draft({ whatsapp: text }), context);
      expect(result.errors.map((e) => e.code)).not.toContain('whatsapp_too_long');
    });

    it('rejects an over-long email body', () => {
      const result = validateGrounding(
        draft({ email_body: Array.from({ length: 130 }, () => 'word').join(' ') }),
        context,
      );
      expect(result.errors.map((e) => e.code)).toContain('email_too_long');
    });
  });

  it('rejects an entirely empty draft', () => {
    const result = validateGrounding(
      { whatsapp: '', email_subject: '', email_body: '', used_finding_ids: [] },
      context,
    );
    expect(result.grounded).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('empty_message');
  });

  it('reports every failure at once so one retry can fix them all', () => {
    const result = validateGrounding(
      {
        whatsapp: 'Guaranteed 500% growth at https://wrong.example/ ' + 'x'.repeat(500),
        email_subject: '',
        email_body: '',
        used_finding_ids: ['NOPE'],
      },
      context,
    );

    const codes = new Set(result.errors.map((e) => e.code));
    expect(codes).toContain('unknown_finding_id');
    expect(codes).toContain('banned_phrase');
    expect(codes).toContain('foreign_url');
    expect(codes).toContain('whatsapp_too_long');
  });

  it('is deterministic for the same input', () => {
    const input = draft({ whatsapp: 'Took 9.9 seconds.' });
    expect(validateGrounding(input, context)).toEqual(validateGrounding(input, context));
  });
});
