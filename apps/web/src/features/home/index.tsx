import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { SearchField } from '../../design/input.js';
import { LeadModal } from '../leads/lead-modal.js';
import { PixelMap } from '../map/index.js';
import type { MapLead } from '../map/index.js';
import { api, subscribeToRun, type RunEvent } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';

/**
 * The home hero.
 *
 * One search field, the pixel map, and a live status line. The search accepts
 * "plumbers in Bhopal" in one box, parsed by `parseSearch` so the user does not
 * have to decide which half is which.
 */

const HOME_COPY = {
  eyebrow: 'Local · open-weight · human-approved',
  headlineA: 'Local sites, audited.',
  headlineB: 'Pitches with proof.',
  subline:
    'Find businesses in one city, measure what is actually wrong with their sites, and get one honest draft per lead. You send every message.',
  placeholder: 'Plumbers in Bhopal',
};

export function Home() {
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [leadId, setLeadId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);

  const { data: leadsData } = useQuery({
    queryKey: queryKeys.leads({ sort: 'score', limit: 50 }),
    queryFn: () => api.leads({ sort: 'score', limit: 50 }),
  });

  const leads = useMemo(() => leadsData?.leads ?? [], [leadsData]);

  // Live run state. Only the ids matter to the map, so the map re-renders once
  // per event rather than on every progress line.
  const [recentlyDiscovered, setRecentlyDiscovered] = useState<Set<string>>(new Set());
  const [recentlyAudited, setRecentlyAudited] = useState<Set<string>>(new Set());

  const handleEvent = useCallback(
    (event: RunEvent) => {
      switch (event.type) {
        case 'run.started':
          setStatus(event.message);
          break;
        case 'lead.discovered':
          if (event.leadId) {
            setRecentlyDiscovered((current) => new Set(current).add(event.leadId as string));
          }
          setStatus(event.message);
          void queryClient.invalidateQueries({ queryKey: ['leads'] });
          break;
        case 'audit.finished':
          if (event.leadId) {
            setRecentlyAudited((current) => new Set(current).add(event.leadId as string));
          }
          setStatus(event.message);
          void queryClient.invalidateQueries({ queryKey: ['leads'] });
          break;
        case 'draft.finished':
          setStatus(event.message);
          void queryClient.invalidateQueries({ queryKey: ['leads'] });
          break;
        case 'run.finished':
        case 'run.failed':
          setStatus(event.message);
          setBusy(false);
          void queryClient.invalidateQueries({ queryKey: ['runs'] });
          break;
        default:
          break;
      }
    },
    [queryClient],
  );

  // Clear the animation triggers so a re-render does not replay them.
  useEffect(() => {
    if (recentlyDiscovered.size === 0 && recentlyAudited.size === 0) return;
    const timer = setTimeout(() => {
      setRecentlyDiscovered(new Set());
      setRecentlyAudited(new Set());
    }, 600);
    return () => clearTimeout(timer);
  }, [recentlyDiscovered, recentlyAudited]);

  useEffect(() => () => unsubscribeRef.current?.(), []);

  const submit = async (): Promise<void> => {
    const parsed = parseSearch(search);
    if (!parsed) {
      setError('Write it like "plumbers in Bhopal".');
      return;
    }

    setError(undefined);
    setBusy(true);
    setStatus('Starting the search');

    try {
      const { runId } = await api.startRun({
        query: parsed.query,
        location: parsed.location,
        limit: 20,
        language: 'en',
      });

      unsubscribeRef.current?.();
      unsubscribeRef.current = subscribeToRun(runId, handleEvent);
    } catch (caught) {
      setBusy(false);
      setStatus(undefined);
      setError(
        caught instanceof Error
          ? caught.message
          : 'The search could not be started. Is the API running on port 8787?',
      );
    }
  };

  const mapLeads: MapLead[] = leads.map((entry) => ({
    id: entry.id,
    name: entry.name,
    lat: entry.lat,
    lng: entry.lng,
    score: entry.opportunityScore,
    auditStatus: entry.auditStatus ?? undefined,
  }));

  return (
    <div className="bg-bg">
      {/*
        Centred, two lines, one phrase each.

        Centred because that is what the hero is: a statement addressed to one
        reader, not a column of text to be scanned. Two lines because a single
        line at this size would need a 1440px measure for a 44-character
        sentence, and anything that wraps mid-phrase reads as an accident.
      */}
      <section className="container pb-8 pt-14 text-center">
        <p className="eyebrow text-paper/70">{HOME_COPY.eyebrow}</p>

        <h1 className="display display-hero mx-auto mt-5 max-w-[20ch]">
          <span className="block text-paper">{HOME_COPY.headlineA}</span>
          <span className="block text-coral">{HOME_COPY.headlineB}</span>
        </h1>

        <p className="prose-measure mx-auto mt-5 text-[16px] leading-relaxed text-paper/75">
          {HOME_COPY.subline}
        </p>

        <div className="mx-auto mt-8 max-w-[620px]">
          <SearchField
            value={search}
            onChange={setSearch}
            onSubmit={() => void submit()}
            placeholder={HOME_COPY.placeholder}
            error={error}
            busy={busy}
          />
        </div>

        {/* Announced politely, so a screen reader hears progress without being
            interrupted mid-sentence by every audit line. */}
        <p
          aria-live="polite"
          className="mono mx-auto mt-4 min-h-[1.25rem] max-w-[60ch] text-[12px] text-paper/70"
        >
          {status ??
            (leads.length > 0
              ? `${leads.length} leads on the map from your last search`
              : 'No leads yet. Search for a business type and a city.')}
        </p>
      </section>

      {/*
        The map runs edge to edge rather than sitting in the container.

        It is the hero's second half, and a map boxed into a column reads as an
        illustration. Full bleed gives it the width to look like a place rather
        than a widget, and the spotlight only makes sense at that size.
      */}
      <section aria-label="Lead map" className="border-y border-ink bg-bg-deep">
        <PixelMap
          leads={mapLeads}
          onSelect={setLeadId}
          recentlyDiscoveredIds={recentlyDiscovered}
          recentlyAuditedIds={recentlyAudited}
        />
      </section>

      <section className="container py-10 text-center">
        <p className="mono text-[13px] text-paper/80">
          Prefer a list?{' '}
          <Link
            to="/leads"
            className="text-paper underline decoration-coral decoration-2 underline-offset-4"
          >
            See every lead
          </Link>
          {/*
            No demo-data link: fixtures mode is already the default when no
            SerpApi key is set, so there is nothing extra to switch on. A link
            to a query parameter nothing reads would be a dead control.
          */}
          .
        </p>
      </section>

      {/* The closing paper band: the promise, and what keeps it. */}
      <section className="border-t border-ink bg-paper-band">
        <div className="container flex flex-wrap items-center justify-between gap-x-10 gap-y-6 py-8">
          <p className="display text-xl text-ink">
            Audit first. <span className="text-red">Pitch second.</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-9 gap-y-3">
            <StripGroup label="Runs on" value="Gemma and Ollama" />
            <StripGroup label="Finds with" value="SerpApi" />
            <StripGroup label="Audits with" value="Lighthouse" />
          </div>
        </div>
      </section>

      {/*
          Clicking a square opens the same modal the leads screen uses, rather
          than a summary band below the map. Two ways to review the same lead
          should not produce two different views of it.
        */}
      <LeadModal
        leadId={leadId}
        onClose={() => setLeadId(null)}
        onOpenChange={(open) => {
          if (!open) setLeadId(null);
        }}
      />
    </div>
  );
}

function StripGroup({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink/50">{label}</p>
      <p className="mono text-[12px] text-ink">{value}</p>
    </div>
  );
}

/**
 * Parse "plumbers in Bhopal".
 *
 * One field rather than two, because the user is describing a thing, not
 * filling in a form. Split on " in " and reject anything else with an example,
 * rather than guessing which half is the city.
 */
export function parseSearch(input: string): { query: string; location: string } | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;

  // Case-insensitive separator, but the first occurrence only, so a query like
  // "plumbing in Bhopal in India" splits where the user most likely meant.
  const separator = /\s+in\s+/i;
  const match = separator.exec(trimmed);
  if (!match) return undefined;

  const query = trimmed.slice(0, match.index).trim();
  const location = trimmed.slice(match.index + match[0].length).trim();

  if (query === '' || location === '') return undefined;

  return { query, location };
}
