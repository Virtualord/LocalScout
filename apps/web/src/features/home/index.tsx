import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { SearchField } from '../../design/input.js';
import { PixelMap } from '../map/index.js';
import type { MapLead } from '../map/index.js';
import { api, subscribeToRun, type LeadSummary, type RunEvent } from '../../lib/api.js';
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
  placeholder: 'Plumbers in Bhopal',
};

export function Home() {
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [lead, setLead] = useState<LeadSummary | undefined>(undefined);

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
      <section className="container flex min-h-[calc(100vh-var(--header-height))] flex-col pb-10 pt-12">
        <p className="eyebrow text-paper/70">{HOME_COPY.eyebrow}</p>

        <h1 className="display display-hero mt-5 max-w-[16ch]">
          <span className="block text-paper">{HOME_COPY.headlineA}</span>
          <span className="block text-coral">{HOME_COPY.headlineB}</span>
        </h1>

        <div className="mt-9">
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
        <p aria-live="polite" className="mono mt-4 min-h-[1.25rem] text-[12px] text-paper/70">
          {status ??
            (leads.length > 0
              ? `${leads.length} leads on the map from your last search`
              : 'No leads yet. Search for a business type and a city.')}
        </p>

        <div className="mt-8">
          <PixelMap
            leads={mapLeads}
            onSelect={(id) => setLead(leads.find((entry) => entry.id === id))}
            recentlyDiscoveredIds={recentlyDiscovered}
            recentlyAuditedIds={recentlyAudited}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Link
            to="/leads"
            className="mono text-[12px] uppercase tracking-wider text-paper underline decoration-coral decoration-2 underline-offset-4"
          >
            See every lead
          </Link>
          <a
            href="/leads?demo=1"
            className="mono text-[12px] uppercase tracking-wider text-paper/70 underline decoration-coral/50 decoration-2 underline-offset-4"
          >
            No SerpApi key yet? Explore with demo data
          </a>
        </div>

        {/* Footer strip, pinned to the bottom of the first viewport. */}
        <div className="mt-auto flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-ink pt-6">
          <p className="display text-[15px] text-red">Audit first. Pitch second.</p>
          <StripGroup label="Runs on" value="Gemma and Ollama" />
          <StripGroup label="Finds with" value="SerpApi" />
          <StripGroup label="Audits with" value="Lighthouse" />
        </div>
      </section>

      {lead && (
        <div className="border-t border-ink bg-paper">
          <div className="container py-8">
            <p className="eyebrow text-ink/60">Selected</p>
            <h2 className="display text-3xl text-ink">{lead.name}</h2>
            <p className="mt-2 text-[14px] text-ink/70">{lead.address ?? 'No address recorded'}</p>
            <div className="mt-5">
              <Link to={`/leads?lead=${lead.id}`} className="btn btn-primary btn-md">
                Open lead
              </Link>
            </div>
          </div>
        </div>
      )}
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
