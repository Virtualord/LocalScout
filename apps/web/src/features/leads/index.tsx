import type { LeadStatus } from '@localscout/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { InteriorHero } from '../../components/sections.js';
import { Button } from '../../design/button.js';
import { Chip } from '../../design/chip.js';
import { Input } from '../../design/input.js';
import { api } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { PixelMap } from '../map/index.js';
import type { MapLead } from '../map/index.js';
import {
  applyFilter,
  parseFilters,
  SCORE_STEPS,
  toQuery,
  writeFilters,
  type LeadFilters,
} from './filters.js';
import { LeadCard, NewSearchCard } from './lead-card.js';
import { LeadModal } from './lead-modal.js';

/**
 * The leads screen.
 *
 * Filters live in the URL, the grid is the default view, and the map is a
 * toggle rather than a separate page: the question a lead list answers is
 * "which of these should I pick up first", and both answers are spatial and
 * ranked.
 */

const STATUS_FILTERS: { label: string; value: LeadStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'New', value: 'discovered' },
  { label: 'Audited', value: 'audited' },
  { label: 'Draft ready', value: 'drafted' },
  { label: 'Sent', value: 'sent' },
  { label: 'Replied', value: 'replied' },
  { label: 'Won', value: 'won' },
];

const SORTS: { label: string; value: LeadFilters['sort'] }[] = [
  { label: 'Best score', value: 'score' },
  { label: 'Newest', value: 'newest' },
  { label: 'Name', value: 'name' },
];

export function LeadsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);

  const setFilters = (patch: Partial<LeadFilters>): void => {
    setSearchParams(new URLSearchParams(writeFilters(applyFilter(filters, patch)).slice(1)));
  };

  const query = toQuery(filters);

  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.leads(query),
    queryFn: () => api.leads(query),
  });

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;

  const mapLeads: MapLead[] = leads.map((entry) => ({
    id: entry.id,
    name: entry.name,
    lat: entry.lat,
    lng: entry.lng,
    score: entry.opportunityScore,
    auditStatus: entry.auditStatus ?? undefined,
  }));

  return (
    <div>
      <InteriorHero
        titleA="Every lead,"
        titleB="with the receipts."
        subline="Sorted by measured opportunity. Nothing here has been sent to anybody."
        accent="coral"
      >
        <ViewToggle view={filters.view} onChange={(view) => setFilters({ view })} />
      </InteriorHero>

      <div className="container py-12">
        <FilterBar filters={filters} total={total} onChange={setFilters} />

        {isPending && <p className="mt-10 text-[15px] text-ink/70">Loading leads…</p>}

        {isError && (
          <div className="mt-10 border-l-4 border-red bg-red/5 px-5 py-4">
            <p className="display text-lg text-red">Could not load leads.</p>
            <p className="mt-1 text-[14px] text-ink/75">
              {error instanceof Error ? error.message : 'The API did not answer.'}
            </p>
            <p className="mt-2 text-[13px] text-ink/60">
              Start the API with <code className="mono">pnpm dev</code>, which boots both the API
              and this app.
            </p>
          </div>
        )}

        {!isPending && !isError && leads.length === 0 && (
          <EmptyState filtered={filters} onClear={() => setSearchParams(new URLSearchParams())} />
        )}

        {!isPending && !isError && leads.length > 0 && (
          <>
            {filters.view === 'map' ? (
              <section aria-label="Lead map" className="mt-8">
                <PixelMap leads={mapLeads} onSelect={(id) => setFilters({ openLeadId: id })} />
                <p className="mono mt-4 text-[12px] text-ink/60">
                  Amber is a hot lead (score 70+), coral is worth a look (40-69), pink is cold. A
                  dashed edge means the site could not be reached, which is not the same as a low
                  score.
                </p>
              </section>
            ) : (
              <ul className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {leads.map((lead) => (
                  <li key={lead.id} className="flex">
                    <div className="flex w-full">
                      <LeadCard lead={lead} onOpen={(id) => setFilters({ openLeadId: id })} />
                    </div>
                  </li>
                ))}
                <li className="flex">
                  <div className="flex w-full">
                    <NewSearchCard />
                  </div>
                </li>
              </ul>
            )}

            {filters.view === 'map' && (
              <ul className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {leads.map((lead) => (
                  <li key={lead.id} className="flex">
                    <div className="flex w-full">
                      <LeadCard lead={lead} onOpen={(id) => setFilters({ openLeadId: id })} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <LeadModal
        leadId={filters.openLeadId}
        onClose={() => setFilters({ openLeadId: null })}
        onOpenChange={(open) => {
          if (!open) setFilters({ openLeadId: null });
        }}
      />
    </div>
  );
}

/** List or map. Two answers to the same question. */
function ViewToggle({
  view,
  onChange,
}: {
  view: LeadFilters['view'];
  onChange: (view: LeadFilters['view']) => void;
}) {
  return (
    <div role="group" aria-label="View" className="inline-flex border border-ink">
      {(['list', 'map'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          onClick={() => onChange(option)}
          className={[
            'mono px-6 py-2.5 text-[12px] font-bold uppercase tracking-[0.14em] transition-colors',
            view === option ? 'bg-ink text-paper' : 'bg-transparent text-paper hover:bg-paper/10',
          ].join(' ')}
        >
          {option === 'list' ? 'List' : 'Map'}
        </button>
      ))}
    </div>
  );
}

function FilterBar({
  filters,
  total,
  onChange,
}: {
  filters: LeadFilters;
  total: number;
  onChange: (patch: Partial<LeadFilters>) => void;
}) {
  return (
    <div className="border-b border-ink/15 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label
            htmlFor="lead-search"
            className="mono mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink/55"
          >
            Search
          </label>
          <Input
            id="lead-search"
            value={filters.q}
            placeholder="Name or address"
            onChange={(event) => onChange({ q: event.target.value })}
            className="w-56"
          />
        </div>

        <div>
          <label
            htmlFor="lead-sort"
            className="mono mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink/55"
          >
            Sort
          </label>
          <select
            id="lead-sort"
            value={filters.sort}
            onChange={(event) => onChange({ sort: event.target.value as LeadFilters['sort'] })}
            className="h-[42px] border border-ink bg-paper px-3 text-[14px] text-ink"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="mono mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/55">
            Score at least
          </p>
          <div role="group" aria-label="Minimum opportunity score" className="flex">
            {SCORE_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                aria-pressed={(filters.minScore ?? 0) === step}
                onClick={() => onChange({ minScore: step === 0 ? null : step })}
                className={[
                  'mono h-[42px] border border-ink px-4 text-[12px] font-bold transition-colors',
                  (filters.minScore ?? 0) === step
                    ? 'bg-ink text-paper'
                    : 'bg-paper text-ink/70 hover:bg-paper-band',
                ].join(' ')}
              >
                {step === 0 ? 'Any' : `${step}+`}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto self-end">
          <p className="mono text-[12px] text-ink/60">
            {total} {total === 1 ? 'lead' : 'leads'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((option) => (
          <Chip
            key={option.value}
            variant={filters.status === option.value ? 'finding' : 'neutral'}
          >
            <button
              type="button"
              aria-pressed={filters.status === option.value}
              onClick={() => onChange({ status: option.value })}
              className="uppercase tracking-wider"
            >
              {option.label}
            </button>
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** The empty state distinguishes "no leads yet" from "no leads match". */
function EmptyState({ filtered, onClear }: { filtered: LeadFilters; onClear: () => void }) {
  const isFiltered = filtered.status !== 'all' || filtered.minScore !== null || filtered.q !== '';

  return (
    <div className="mt-10 max-w-[60ch]">
      <p className="display text-3xl text-ink">
        {isFiltered ? 'Nothing matches those filters.' : 'No leads yet.'}
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink/75">
        {isFiltered
          ? 'The leads are probably still here. Widen the score or clear the search.'
          : 'Run a search from the home page. It audits every site it finds and writes one draft per lead.'}
      </p>
      <div className="mt-6 flex gap-3">
        {isFiltered && (
          <Button variant="secondary" onClick={onClear}>
            Clear the filters
          </Button>
        )}
        <Link to="/" className="btn btn-primary btn-md">
          Start a search
        </Link>
      </div>
    </div>
  );
}
