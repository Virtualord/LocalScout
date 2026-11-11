import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { SectionHeader, Band, WorkflowStep } from '../../components/sections.js';
import { Card, ComparisonCard } from '../../design/card.js';
import { Chip } from '../../design/chip.js';
import { CompassMark, LocationPin, NeighbourhoodGrid } from '../../design/decorations.js';
import { SearchField } from '../../design/input.js';
import { Accordion, AccordionItem } from '../../design/primitives.js';
import { LeadModal } from '../leads/lead-modal.js';
import { PixelMap } from '../map/index.js';
import type { MapLead } from '../map/index.js';
import { api, subscribeToRun, type RunEvent } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';

/**
 * The home page.
 *
 * An editorial field atlas for one product: a two-column hero that pairs the
 * promise with a "field note" plate showing the workflow, the survey map, and
 * then the four sections that answer what it does, where it runs, what the
 * score means, and what it refuses to do.
 *
 * The map is the same map as the leads screen, so a square opens the same
 * modal. Nothing on this page claims a measurement: the plate is a diagram, not
 * a fake audit.
 */

const HOME_COPY = {
  eyebrow: 'Local-first · open-weight · human-approved',
  headlineA: 'Local sites, audited.',
  headlineB: 'Pitches with proof.',
  subline:
    'Find businesses in one city, measure what is actually wrong with their sites, and get one honest draft per lead. You send every message.',
  placeholder: 'Plumbers in Bhopal',
};

const FIELD_STEPS = [
  { title: 'Discover', copy: 'One city, one business type, a map of real listings.' },
  { title: 'Measure', copy: 'The site is fetched and audited. No metric is guessed.' },
  { title: 'Draft', copy: 'A short message that cites only what was measured.' },
];

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
    <div className="bg-paper">
      {/* ---------------------------------------------------------------- */}
      {/* Hero: the promise on the left, a field note on the right.        */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden bg-bg">
        <CompassMark
          size={180}
          className="pointer-events-none absolute right-[38%] top-10 hidden text-paper/10 xl:block"
        />

        <div className="container relative grid gap-12 pb-16 pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:pb-20 lg:pt-20">
          <div>
            <p className="eyebrow text-paper/70">{HOME_COPY.eyebrow}</p>

            <h1 className="display display-hero mt-6 max-w-[15ch]">
              <span className="block text-paper">{HOME_COPY.headlineA}</span>
              <span className="block text-coral">{HOME_COPY.headlineB}</span>
            </h1>

            <p className="prose-measure mt-6 max-w-[52ch] text-[16px] leading-relaxed text-paper/75">
              {HOME_COPY.subline}
            </p>

            <div className="mt-9 max-w-[620px]">
              <SearchField
                value={search}
                onChange={setSearch}
                onSubmit={() => void submit()}
                placeholder={HOME_COPY.placeholder}
                error={error}
                busy={busy}
              />
            </div>

            {/* Announced politely, so a screen reader hears progress without
                being interrupted mid-sentence by every audit line. */}
            <p
              aria-live="polite"
              className="mono mt-4 min-h-[1.25rem] max-w-[60ch] text-[12px] text-paper/70"
            >
              {status ??
                (leads.length > 0
                  ? `${leads.length} leads on the map from your last search`
                  : 'No leads yet. Search for a business type and a city.')}
            </p>
          </div>

          {/* The field note plate: a diagram of the workflow, not a fake audit. */}
          <div className="lg:justify-self-end">
            <div className="plate-settle relative mx-auto w-full max-w-[420px] rotate-[1.5deg] border-2 border-ink bg-paper p-5 text-ink hard-shadow">
              <div className="flex items-center justify-between gap-3">
                <span className="mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink/70">
                  Field note · 01
                </span>
                <LocationPin size={16} className="text-coral" />
              </div>

              <div className="relative mt-4 overflow-hidden border border-ink/20 bg-paper-band">
                <NeighbourhoodGrid cols={9} rows={5} cell={20} gap={3} seed={7} />
                <LocationPin size={22} className="absolute left-[56%] top-[30%] text-coral" />
              </div>

              <ol className="mt-4 space-y-3">
                {FIELD_STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3 border-t border-ink/15 pt-3">
                    <span className="mono w-6 shrink-0 text-[10px] font-bold tracking-[0.16em] text-coral-deep">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="text-[14px] font-semibold leading-tight">{step.title}</p>
                      <p className="mt-0.5 text-[12px] leading-snug text-ink/70">{step.copy}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="mono mt-4 border-t border-ink/15 pt-3 text-[10px] uppercase tracking-[0.14em] text-ink/65">
                You send every message.
              </p>
            </div>
          </div>
        </div>

        <div className="rule-ticks" />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The survey map.                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section aria-label="Lead map" className="border-y-2 border-ink bg-bg-deep">
        <div className="container flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="eyebrow text-paper/60">Survey map</span>
          <span className="mono text-[11px] uppercase tracking-[0.14em] text-paper/65">
            One square, one business · hover to plot it
          </span>
        </div>
        <div className="border-t border-paper/15">
          <PixelMap
            leads={mapLeads}
            onSelect={setLeadId}
            recentlyDiscoveredIds={recentlyDiscovered}
            recentlyAuditedIds={recentlyAudited}
          />
        </div>
      </section>

      <div className="container flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-6 text-center">
        <span className="mono text-[12px] text-ink/65">Prefer a list?</span>
        <Link
          to="/leads"
          className="mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink underline decoration-coral decoration-2 underline-offset-4 hover:decoration-amber"
        >
          See every lead
        </Link>
        <span className="mono text-[12px] text-ink/65">→</span>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* How it works.                                                     */}
      {/* ---------------------------------------------------------------- */}
      <Band id="how" tone="paper" edge="ticks">
        <SectionHeader
          eyebrow="The short version"
          titleA="From a city to"
          titleB="a sendable draft."
          intro="Four steps, each one a promise the rest of the app keeps. The person who wrote the message is the person who sends it."
        />

        <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <WorkflowStep index={1} title="Discover">
            A business type and a city become real Google Maps listings: a place, a phone number and
            a website.
          </WorkflowStep>
          <WorkflowStep index={2} title="Dedupe">
            Anything already found or already contacted is skipped, so the same business is never
            pitched twice.
          </WorkflowStep>
          <WorkflowStep index={3} title="Audit & score">
            The site is checked for structure and measured where possible. Twelve weighted findings
            produce one opportunity score.
          </WorkflowStep>
          <WorkflowStep index={4} title="Draft & verify">
            A local model writes from those findings. An invented number is caught and replaced with
            a template.
          </WorkflowStep>
        </ol>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-6 border-2 border-ink bg-band-dark px-6 py-6 text-paper hard-shadow-gold">
          <div className="flex items-center gap-4">
            <LocationPin size={24} className="text-amber" />
            <p className="display text-xl text-paper">
              Audit first. <span className="text-amber">Pitch second.</span>
            </p>
          </div>
          <p className="mono max-w-[44ch] text-[11px] uppercase leading-relaxed tracking-[0.12em] text-paper/60">
            There is no send path in this codebase. Drafts go to your clipboard, and you decide what
            happens next.
          </p>
        </div>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* What it is.                                                       */}
      {/* ---------------------------------------------------------------- */}
      <Band id="what" tone="paper-2">
        <SectionHeader
          eyebrow="Local-first, by construction"
          titleA="Your data stays"
          titleB="on your machine."
          intro="No account, no cloud database, no telemetry. The trade-off is that it does not sync — which is also the point."
        />

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <ComparisonCard
            title="Where it runs"
            chip={<Chip variant="status-won">Local</Chip>}
            rows={[
              { label: 'Interface', value: 'React, in your browser' },
              { label: 'API', value: 'Hono on 127.0.0.1:8787' },
              { label: 'Database', value: 'SQLite in ./data' },
              { label: 'Model', value: 'Ollama on your machine' },
            ]}
          />
          <ComparisonCard
            title="What it sends"
            chip={<Chip variant="neutral">Nothing automatic</Chip>}
            rows={[
              { label: 'Messages', value: 'Never — there is no send path' },
              { label: 'Telemetry', value: 'None' },
              { label: 'Discovery', value: 'SerpApi, only with a key' },
              { label: 'Audits', value: 'One visit per site, per audit' },
            ]}
          />
        </div>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* What the score means.                                             */}
      {/* ---------------------------------------------------------------- */}
      <Band id="score" tone="dark">
        <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-end">
          <div>
            <p className="eyebrow text-amber/80">Evidence, not vibes</p>
            <h2 className="display display-section mt-4">
              <span className="block text-paper">One score, </span>
              <span className="block text-coral">twelve measurements.</span>
            </h2>
          </div>
          <p className="prose-measure text-[15px] leading-relaxed text-paper/70 md:justify-self-end">
            The score is a hypothesis about what makes a good lead, and the weights are in a table
            so you can argue with them. A missing measurement is never scored as a zero.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            {
              index: '01',
              title: 'Measured',
              copy: 'HTTPS, mobile readiness, title, description, contact links, and real Lighthouse numbers where Chrome is available.',
            },
            {
              index: '02',
              title: 'Weighted',
              copy: 'Every finding has an explicit weight. The total is the opportunity score, from 0 to 100, and nothing is hidden in a formula.',
            },
            {
              index: '03',
              title: 'Honest',
              copy: 'A site that could not be reached is marked unavailable, not cold. An audit without Chrome is labelled structural, not failed.',
            },
          ].map((item) => (
            <Card key={item.index} className="p-6" static>
              <span className="mono text-[11px] font-bold tracking-[0.2em] text-amber">
                {item.index}
              </span>
              <h3 className="display mt-3 text-xl text-ink">{item.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink/70">{item.copy}</p>
            </Card>
          ))}
        </div>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* Built with.                                                       */}
      {/* ---------------------------------------------------------------- */}
      <Band id="built" tone="teal">
        <SectionHeader eyebrow="Built with" titleA="Small, sharp" titleB="pieces." onDark />

        <ul className="mt-12 grid gap-x-10 gap-y-0 border-t border-paper/25 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Workflow', 'Mastra'],
            ['Discovery', 'SerpApi'],
            ['Audit', 'Lighthouse + HTTP'],
            ['Storage', 'SQLite + Drizzle'],
            ['API', 'Hono'],
            ['Interface', 'React + Vite'],
          ].map(([role, value]) => (
            <li
              key={role}
              className="flex items-baseline justify-between gap-4 border-b border-paper/20 py-4"
            >
              <span className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber/75">
                {role}
              </span>
              <span className="mono text-[13px] text-paper">{value}</span>
            </li>
          ))}
        </ul>

        <p className="mono mt-8 max-w-[60ch] text-[12px] leading-relaxed text-paper/65">
          Fixtures mode is the default: the whole pipeline runs with no key, no Chrome and no model.
          Live discovery and real drafts are opt-in, in your own .env.
        </p>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* Questions.                                                        */}
      {/* ---------------------------------------------------------------- */}
      <Band id="faq" tone="paper">
        <SectionHeader
          eyebrow="Before you trust a number"
          titleA="Questions worth"
          titleB="asking."
        />

        <Accordion type="single" collapsible className="mt-10 border-t-2 border-ink">
          {FAQ.map((item) => (
            <AccordionItem key={item.value} value={item.value} question={item.question}>
              {item.answer}
            </AccordionItem>
          ))}
        </Accordion>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* Closing strip.                                                    */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-t-2 border-ink bg-paper-band">
        <div className="container flex flex-wrap items-center justify-between gap-x-10 gap-y-6 py-8">
          <p className="display text-xl text-ink">
            Audit first. <span className="text-coral-deep">Pitch second.</span>
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
      <p className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink/65">{label}</p>
      <p className="mono text-[12px] text-ink">{value}</p>
    </div>
  );
}

const FAQ = [
  {
    value: 'sends',
    question: 'Does Localscout send messages?',
    answer:
      'No. There is no send code path anywhere in the project. Every draft is text on your clipboard, and the only record of outreach is what you tell the app you did.',
  },
  {
    value: 'data',
    question: 'What leaves my machine?',
    answer:
      'Your search terms and city go to SerpApi only when you configure a key. Each business URL is fetched on its own connection, behind an SSRF guard. The model sees structured findings, never raw page text. Nothing else moves.',
  },
  {
    value: 'numbers',
    question: 'What happens when a measurement is missing?',
    answer:
      'It stays missing. A site with no Chrome available is audited for structure and labelled stale; a site that could not be reached is labelled unavailable. Neither is scored as a zero, and neither can produce a draft that quotes a number.',
  },
  {
    value: 'score',
    question: 'How is the opportunity score calculated?',
    answer:
      'Twelve findings, each with an explicit weight, summed to a score out of 100. A bad site on an active business scores higher than the same site on a dormant one. The weights are a table in the source, not a hidden model.',
  },
] as const;

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
