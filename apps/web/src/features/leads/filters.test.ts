import { describe, expect, it } from 'vitest';
import {
  applyFilter,
  DEFAULT_FILTERS,
  parseFilters,
  SCORE_STEPS,
  toQuery,
  writeFilters,
} from './filters.js';

/**
 * Filters are the one place on this screen where a silent mistake costs a real
 * SerpApi credit or hides a hot lead, so the URL round trip is pinned.
 */
describe('parseFilters', () => {
  it('returns the defaults for an empty query string', () => {
    expect(parseFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it('reads a status', () => {
    expect(parseFilters(new URLSearchParams('status=drafted')).status).toBe('drafted');
  });

  it('ignores an unknown status rather than filtering to nothing', () => {
    // A typo in a shared link should show every lead, not an empty list that
    // looks like "nothing to do here".
    expect(parseFilters(new URLSearchParams('status=nonsense')).status).toBe('all');
  });

  it('reads a minimum score', () => {
    expect(parseFilters(new URLSearchParams('min=70')).minScore).toBe(70);
  });

  it('treats a non-numeric minimum as absent', () => {
    expect(parseFilters(new URLSearchParams('min=abc')).minScore).toBeNull();
  });

  it('reads a search term', () => {
    expect(parseFilters(new URLSearchParams('q=sharma')).q).toBe('sharma');
  });

  it('reads a sort', () => {
    expect(parseFilters(new URLSearchParams('sort=name')).sort).toBe('name');
  });

  it('falls back to score for an unknown sort', () => {
    expect(parseFilters(new URLSearchParams('sort=sideways')).sort).toBe('score');
  });

  it('reads the map view', () => {
    expect(parseFilters(new URLSearchParams('view=map')).view).toBe('map');
  });

  it('falls back to the list view for an unknown view', () => {
    expect(parseFilters(new URLSearchParams('view=3d')).view).toBe('list');
  });

  it('reads the open lead', () => {
    expect(parseFilters(new URLSearchParams('lead=abc')).openLeadId).toBe('abc');
  });

  it('reads a full set at once', () => {
    const parsed = parseFilters(
      new URLSearchParams('status=sent&min=60&q=das&sort=newest&view=map&lead=x1'),
    );
    expect(parsed).toEqual({
      status: 'sent',
      minScore: 60,
      q: 'das',
      sort: 'newest',
      view: 'map',
      openLeadId: 'x1',
    });
  });
});

describe('writeFilters', () => {
  it('writes nothing for the defaults, so the common URL stays clean', () => {
    expect(writeFilters(DEFAULT_FILTERS)).toBe('');
  });

  it('writes a status', () => {
    expect(writeFilters({ ...DEFAULT_FILTERS, status: 'sent' })).toBe('?status=sent');
  });

  it('writes a minimum score', () => {
    expect(writeFilters({ ...DEFAULT_FILTERS, minScore: 80 })).toBe('?min=80');
  });

  it('writes a search term', () => {
    expect(writeFilters({ ...DEFAULT_FILTERS, q: 'das' })).toBe('?q=das');
  });

  it('writes a non-default sort', () => {
    expect(writeFilters({ ...DEFAULT_FILTERS, sort: 'newest' })).toBe('?sort=newest');
  });

  it('omits the default sort', () => {
    expect(writeFilters({ ...DEFAULT_FILTERS, sort: 'score' })).toBe('');
  });

  it('writes the map view', () => {
    expect(writeFilters({ ...DEFAULT_FILTERS, view: 'map' })).toBe('?view=map');
  });

  it('writes the open lead', () => {
    expect(writeFilters({ ...DEFAULT_FILTERS, openLeadId: 'x1' })).toBe('?lead=x1');
  });

  it('round trips every field', () => {
    const filters = {
      status: 'won' as const,
      minScore: 40,
      q: 'verma electricals',
      sort: 'name' as const,
      view: 'map' as const,
      openLeadId: 'lead-7',
    };
    expect(parseFilters(new URLSearchParams(writeFilters(filters).slice(1)))).toEqual(filters);
  });
});

describe('toQuery', () => {
  it('omits the status when it is all', () => {
    expect(toQuery(DEFAULT_FILTERS).status).toBeUndefined();
  });

  it('includes the status when filtered', () => {
    expect(toQuery({ ...DEFAULT_FILTERS, status: 'drafted' }).status).toBe('drafted');
  });

  it('omits an absent minimum', () => {
    expect(toQuery(DEFAULT_FILTERS).minScore).toBeUndefined();
  });

  it('includes a zero minimum rather than treating it as absent', () => {
    // 0 is a real filter; `|| undefined` would silently drop it.
    expect(toQuery({ ...DEFAULT_FILTERS, minScore: 0 }).minScore).toBe(0);
  });

  it('omits an empty search term', () => {
    expect(toQuery(DEFAULT_FILTERS).q).toBeUndefined();
  });

  it('always carries the sort and a limit', () => {
    const query = toQuery(DEFAULT_FILTERS);
    expect(query.sort).toBe('score');
    expect(query.limit).toBe(100);
  });
});

describe('applyFilter', () => {
  it('replaces only the patched fields', () => {
    expect(applyFilter({ ...DEFAULT_FILTERS, q: 'das' }, { status: 'sent' })).toMatchObject({
      q: 'das',
      status: 'sent',
    });
  });

  it('can clear the open lead', () => {
    expect(
      applyFilter({ ...DEFAULT_FILTERS, openLeadId: 'x' }, { openLeadId: null }).openLeadId,
    ).toBeNull();
  });
});

describe('SCORE_STEPS', () => {
  it('starts at zero so "no minimum" is a visible choice', () => {
    expect(SCORE_STEPS[0]).toBe(0);
  });

  it('is ascending', () => {
    for (let i = 1; i < SCORE_STEPS.length; i += 1) {
      expect(SCORE_STEPS[i]).toBeGreaterThan(SCORE_STEPS[i - 1] ?? 0);
    }
  });
});
