import type { LeadStatus } from '@localscout/core';

/**
 * Lead filters.
 *
 * Pure state <-> URL translation, so a filtered list is a link somebody can
 * paste into Slack and the browser back button behaves. Doing this in the
 * component with nine `useState` calls would work right up until the first
 * share, and then quietly not.
 */

export type LeadSort = 'score' | 'newest' | 'name';
export type LeadView = 'list' | 'map';

export interface LeadFilters {
  status: LeadStatus | 'all';
  /** Minimum opportunity score, 0 to 100, or null for no minimum. */
  minScore: number | null;
  q: string;
  sort: LeadSort;
  view: LeadView;
  /** The lead open in the modal, if any. */
  openLeadId: string | null;
}

/** The filters a fresh visit starts with: everything, best score first. */
export const DEFAULT_FILTERS: LeadFilters = {
  status: 'all',
  minScore: null,
  q: '',
  sort: 'score',
  view: 'list',
  openLeadId: null,
};

/** Filter steps offered as buttons, rather than a range input. */
export const SCORE_STEPS = [0, 40, 60, 80] as const;

/** Read filters out of a query string. Unknown values fall back to the default. */
export function parseFilters(params: URLSearchParams): LeadFilters {
  const status = params.get('status');
  const minScore = params.get('min');
  const sort = params.get('sort');
  const view = params.get('view');

  const validStatuses: LeadStatus[] = [
    'discovered',
    'audited',
    'drafted',
    'approved',
    'sent',
    'replied',
    'won',
    'lost',
    'skipped',
  ];

  return {
    status: validStatuses.includes(status as LeadStatus) ? (status as LeadStatus) : 'all',
    minScore: minScore !== null && Number.isFinite(Number(minScore)) ? Number(minScore) : null,
    q: params.get('q') ?? '',
    sort: sort === 'newest' || sort === 'name' || sort === 'score' ? sort : 'score',
    view: view === 'map' ? 'map' : 'list',
    openLeadId: params.get('lead'),
  };
}

/**
 * Write filters back to a query string.
 *
 * Defaults are omitted so the common case stays a clean `/leads` rather than
 * `/leads?sort=score&view=list`, which is what makes the URL worth reading.
 */
export function writeFilters(filters: LeadFilters): string {
  const params = new URLSearchParams();

  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.minScore !== null) params.set('min', String(filters.minScore));
  if (filters.q !== '') params.set('q', filters.q);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.view !== DEFAULT_FILTERS.view) params.set('view', filters.view);
  if (filters.openLeadId !== null) params.set('lead', filters.openLeadId);

  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** The API query for a set of filters. */
export function toQuery(filters: LeadFilters): {
  status?: LeadStatus;
  minScore?: number;
  q?: string;
  sort: LeadSort;
  limit: number;
} {
  return {
    ...(filters.status === 'all' ? {} : { status: filters.status }),
    ...(filters.minScore === null ? {} : { minScore: filters.minScore }),
    ...(filters.q === '' ? {} : { q: filters.q }),
    sort: filters.sort,
    limit: 100,
  };
}

/** Apply a filter change, keeping the open lead unless the change clears it. */
export function applyFilter(current: LeadFilters, patch: Partial<LeadFilters>): LeadFilters {
  return { ...current, ...patch };
}
