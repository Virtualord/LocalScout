import { describe, expect, it } from 'vitest';
import { milestones, statusRows } from './index.js';

/**
 * The dashboard's derived rows.
 *
 * Both functions exist to avoid one specific failure: showing a `0%` grounded
 * rate when nothing has been drafted yet. A zero denominator and a zero rate
 * are different facts, and the dashboard has to tell them apart.
 */

const base = {
  outreach: {
    milestones: {
      firstMessageSent: true,
      firstReply: false,
      firstMeeting: false,
      firstClient: false,
    },
  },
  leads: { byStatus: { discovered: 3, audited: 2, drafted: 1, sent: 0 } },
};

describe('milestones', () => {
  it('lists the four milestones in funnel order', () => {
    expect(milestones(base).map((m) => m.label)).toEqual([
      'First message sent',
      'First reply',
      'First meeting',
      'First paying client',
    ]);
  });

  it('reads the booleans from the API', () => {
    expect(milestones(base).map((m) => m.done)).toEqual([true, false, false, false]);
  });

  it('treats a missing milestone key as not reached', () => {
    const partial = { outreach: { milestones: {} } };
    expect(milestones(partial).every((m) => !m.done)).toBe(true);
  });

  it('never invents progress for an all-false set', () => {
    const none = {
      outreach: {
        milestones: {
          firstMessageSent: false,
          firstReply: false,
          firstMeeting: false,
          firstClient: false,
        },
      },
    };
    expect(milestones(none).filter((m) => m.done)).toHaveLength(0);
  });
});

describe('statusRows', () => {
  it('only shows statuses that have leads in them', () => {
    // A row of zeros for every status is 8 lines of noise on a fresh install.
    const rows = statusRows(base);
    expect(rows.map((row) => row.label)).toEqual(['Discovered', 'Audited', 'Draft ready']);
  });

  it('formats the count as a string', () => {
    expect(statusRows(base)[0]?.value).toBe('3');
  });

  it('humanises an unknown status key rather than dropping it', () => {
    // A new status in the database should show up, not vanish silently.
    const rows = statusRows({ leads: { byStatus: { brand_new_status: 4 } } });
    expect(rows).toEqual([{ label: 'brand_new_status', value: '4' }]);
  });

  it('returns nothing for an empty database', () => {
    expect(statusRows({ leads: { byStatus: {} } })).toEqual([]);
  });

  it('includes a status whose count is nonzero even at one', () => {
    const rows = statusRows({ leads: { byStatus: { won: 1 } } });
    expect(rows).toEqual([{ label: 'Won', value: '1' }]);
  });
});
