import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { InteriorHero } from '../../components/sections.js';
import { Card, ComparisonRow } from '../../design/card.js';
import { Chip } from '../../design/chip.js';
import { Accordion, AccordionItem } from '../../design/primitives.js';
import { api } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';

/**
 * The dashboard.
 *
 * Numbers the user can act on, and one thing they cannot get from the API: the
 * outreach milestones. Those only advance when the human records that they sent
 * a message, which is the honest half of a funnel nobody can automate.
 *
 * Every rate here is computed from counted rows. Where a denominator is zero,
 * the screen says "no data" rather than showing `0%`, because a 0% grounded rate
 * and an unknown grounded rate are completely different situations.
 */

export function DashboardScreen() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.metrics,
    queryFn: api.metrics,
    // Metrics are derived from everything; recompute them on each visit rather
    // than serving a stale snapshot after a run finishes.
    staleTime: 0,
  });

  return (
    <div>
      <InteriorHero
        titleA="Where the work"
        titleB="actually stands."
        subline="Counted from the database, not estimated. Missing data reads as missing."
        accent="amber"
      />

      <div className="container py-12">
        {isPending && <p className="text-[15px] text-ink/70">Loading metrics…</p>}

        {isError && (
          <div className="border-l-4 border-red bg-red/5 px-5 py-4">
            <p className="display text-lg text-red">Could not load metrics.</p>
            <p className="mt-1 text-[14px] text-ink/75">
              {error instanceof Error ? error.message : 'The API did not answer.'}
            </p>
          </div>
        )}

        {data !== undefined && (
          <div className="space-y-16">
            <section aria-labelledby="milestones-heading">
              <h2 id="milestones-heading" className="display display-section text-ink">
                Outreach milestones
              </h2>
              <p className="prose-measure mt-3 text-[15px] leading-relaxed text-ink/70">
                These advance when you mark a message as sent or logged a reply. Nothing here moves
                on its own, because sending is the part this tool refuses to do.
              </p>
              <ol className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {milestones(data).map((milestone, index) => (
                  <li key={milestone.label}>
                    <Card
                      tier={milestone.done ? 'hot' : 'normal'}
                      className="flex h-full flex-col gap-3 p-5"
                    >
                      <span className="mono text-[11px] font-bold tracking-[0.16em] text-ink/45">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <p className="display text-xl text-ink">{milestone.label}</p>
                      <div className="mt-auto">
                        <Chip variant={milestone.done ? 'status-won' : 'neutral'}>
                          {milestone.done ? 'Reached' : 'Not yet'}
                        </Chip>
                      </div>
                    </Card>
                  </li>
                ))}
              </ol>
              <p className="mono mt-5 text-[12px] text-ink/60">
                {data.outreach.totalEntries} contact log{' '}
                {data.outreach.totalEntries === 1 ? 'entry' : 'entries'} recorded across all leads.
              </p>
            </section>

            <section aria-labelledby="pipeline-heading">
              <h2 id="pipeline-heading" className="display display-section text-ink">
                The pipeline
              </h2>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card className="p-0">
                  <CardHeading>Leads by status</CardHeading>
                  {statusRows(data).map((row) => (
                    <ComparisonRow key={row.label} label={row.label} value={row.value} />
                  ))}
                </Card>

                <Card className="p-0">
                  <CardHeading>Audits</CardHeading>
                  <ComparisonRow label="Total" value={String(data.audits.total)} />
                  <ComparisonRow label="Completed" value={String(data.audits.byStatus.ok)} />
                  <ComparisonRow
                    label="Structural only"
                    value={String(data.audits.byStatus.stale)}
                  />
                  <ComparisonRow
                    label="Unreachable"
                    value={String(data.audits.byStatus.unavailable)}
                  />
                  <ComparisonRow
                    label="Average duration"
                    value={
                      data.audits.averageDurationMs === null
                        ? 'no data'
                        : `${(data.audits.averageDurationMs / 1000).toFixed(1)}s`
                    }
                  />
                </Card>

                <Card className="p-0">
                  <CardHeading>Drafts</CardHeading>
                  <ComparisonRow label="Total" value={String(data.drafts.total)} />
                  <ComparisonRow label="From the model" value={String(data.drafts.fromModel)} />
                  <ComparisonRow
                    label="From the template"
                    value={String(data.drafts.fromTemplate)}
                  />
                  <ComparisonRow
                    label="Fully grounded"
                    value={
                      data.drafts.total === 0
                        ? 'no data'
                        : `${data.drafts.groundedPercent.toFixed(0)}% (${data.drafts.grounded}/${data.drafts.total})`
                    }
                  />
                  <ComparisonRow
                    label="Average latency"
                    value={
                      data.drafts.averageLatencyMs === null
                        ? 'no data'
                        : `${(data.drafts.averageLatencyMs / 1000).toFixed(1)}s`
                    }
                  />
                </Card>

                <Card className="p-0">
                  <CardHeading>Cost</CardHeading>
                  <ComparisonRow label="SerpApi calls" value={String(data.cost.serpApiCalls)} />
                  <ComparisonRow
                    label="Calls per new lead"
                    value={
                      data.cost.serpApiCallsPerLead === null
                        ? 'no data'
                        : data.cost.serpApiCallsPerLead.toFixed(2)
                    }
                  />
                  <ComparisonRow
                    label="LLM cost per lead"
                    value={`$${data.cost.llmCostPerLead.toFixed(4)}`}
                  />
                </Card>
              </div>
              <p className="mono mt-5 text-[12px] text-ink/60">{data.cost.note}</p>
            </section>

            <section aria-labelledby="runs-heading">
              <h2 id="runs-heading" className="display display-section text-ink">
                Where the leads came from
              </h2>
              <Card className="mt-6 p-0">
                <ComparisonRow label="Runs started" value={String(data.runs.runs)} />
                <ComparisonRow
                  label="Results found"
                  value={`${data.runs.leadsFound} (${data.runs.leadsNew} new)`}
                />
                <ComparisonRow
                  label="Audits"
                  value={`${data.runs.auditsOk} completed, ${data.runs.auditsFailed} failed`}
                />
                <ComparisonRow
                  label="Tokens"
                  value={`${data.runs.tokensIn} in / ${data.runs.tokensOut} out`}
                />
              </Card>
              <div className="mt-6">
                <Link to="/runs" className="btn btn-secondary btn-md">
                  See the run log
                </Link>
              </div>
            </section>

            <section aria-labelledby="explain-heading">
              <h2 id="explain-heading" className="display display-section text-ink">
                What these numbers mean
              </h2>
              <Accordion type="single" collapsible className="mt-6 border-t border-ink/15">
                {EXPLANATIONS.map((item) => (
                  <AccordionItem key={item.value} value={item.value} question={item.question}>
                    {item.answer}
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function CardHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mono border-b border-ink/20 bg-paper-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-ink/60">
      {children}
    </p>
  );
}

interface Milestone {
  label: string;
  done: boolean;
}

/** The funnel in order, so the numbers read as a progression. */
export function milestones(metrics: {
  outreach: { milestones: Record<string, boolean> };
}): Milestone[] {
  const m = metrics.outreach.milestones;
  return [
    { label: 'First message sent', done: m.firstMessageSent ?? false },
    { label: 'First reply', done: m.firstReply ?? false },
    { label: 'First meeting', done: m.firstMeeting ?? false },
    { label: 'First paying client', done: m.firstClient ?? false },
  ];
}

/** Lead status counts, skipping statuses with nothing in them. */
export function statusRows(metrics: {
  leads: { byStatus: Record<string, number> };
}): { label: string; value: string }[] {
  const labels: Record<string, string> = {
    discovered: 'Discovered',
    audited: 'Audited',
    drafted: 'Draft ready',
    approved: 'Reviewed',
    sent: 'Sent',
    replied: 'Replied',
    won: 'Won',
    lost: 'Lost',
    skipped: 'Skipped',
  };

  return Object.entries(metrics.leads.byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ label: labels[status] ?? status, value: String(count) }));
}

const EXPLANATIONS = [
  {
    value: 'grounded',
    question: 'What does "fully grounded" mean?',
    answer:
      "Every number and every claim in the draft traces back to a finding this run measured on this business's own site. A draft that fails that check is not sent to the model again with a softer prompt; it is replaced with a template that can only say what was measured. The fallback rate is a quality signal, not a failure.",
  },
  {
    value: 'stale',
    question: 'Why is an audit "structural only" rather than failed?',
    answer:
      'The page could be fetched and parsed, but Chrome was not available on the machine that ran the audit, so the timing metrics do not exist. Those audits carry the HTML checks and none of the Lighthouse numbers. They are labelled stale rather than ok, because a missing metric is not a passing metric.',
  },
  {
    value: 'unreachable',
    question: 'What does "unreachable" mean for a pitch?',
    answer:
      'The site could not be fetched at all: DNS failed, the connection was refused, or the response was blocked by the SSRF guard. That lead gets a dashed square on the map and no claims about its performance. An unreachable site is not a bad site, and pitching it as one would be dishonest.',
  },
  {
    value: 'cost',
    question: 'Why are calls per lead usually above one?',
    answer:
      'One search is a SerpApi call, and a run usually runs more than one when a page comes back thin. Deduplication also means a business already in the database is skipped rather than re-fetched, so the ratio improves as the database grows.',
  },
] as const;
