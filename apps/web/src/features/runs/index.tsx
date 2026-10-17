import type { RunStatus } from '@localscout/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { InteriorHero } from '../../components/sections.js';
import { Button } from '../../design/button.js';
import { Card, ComparisonRow } from '../../design/card.js';
import { Chip } from '../../design/chip.js';
import { api, type RunSummary } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';

/**
 * The run log.
 *
 * A run is one search: what was asked, what was found, what was audited, what
 * was drafted, and what it cost. Failures are shown with their error rather
 * than hidden, because a run that found nothing usually means the key is
 * missing or the query was too narrow, and both are worth knowing.
 *
 * A run that is still going can be stopped from here. That is the way out of the
 * "a search is already running" refusal on the home screen, and the way to
 * recover from a run whose process died: until it ends, no new search can start.
 */

export function RunsScreen() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.runs,
    queryFn: () => api.runs(100),
  });

  const runs = data?.runs ?? [];

  return (
    <div>
      <InteriorHero
        titleA="Every run,"
        titleB="accounted for."
        subline="What was searched, what it cost in API calls and tokens, and what failed."
        accent="blue"
      />

      <div className="container py-12">
        {isPending && <p className="text-[15px] text-ink/70">Loading runs…</p>}

        {isError && (
          <div className="border-l-4 border-red bg-red/5 px-5 py-4">
            <p className="display text-lg text-red">Could not load runs.</p>
            <p className="mt-1 text-[14px] text-ink/75">
              {error instanceof Error ? error.message : 'The API did not answer.'}
            </p>
          </div>
        )}

        {!isPending && !isError && runs.length === 0 && (
          <div className="max-w-[60ch]">
            <p className="display text-3xl text-ink">No runs yet.</p>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/75">
              A run is created every time you search. Each one is logged here from the moment it
              starts, so an interrupted run is visible rather than lost.
            </p>
            <div className="mt-6">
              <Link to="/" className="btn btn-primary btn-md">
                Start a search
              </Link>
            </div>
          </div>
        )}

        {runs.length > 0 && (
          <ul className="space-y-6">
            {runs.map((run) => (
              <li key={run.id}>
                <RunCard run={run} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunCard({ run }: { run: RunSummary }) {
  const queryClient = useQueryClient();

  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
    },
  });

  // Only a run that is going somewhere can be stopped. A finished, failed or
  // already-cancelled run has nothing left to stop.
  const stoppable = run.status === 'queued' || run.status === 'running';

  return (
    <Card className="p-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink/20 px-5 py-4">
        <div>
          <h2 className="display text-2xl text-ink">
            {run.query} <span className="text-ink/45">in</span> {run.location}
          </h2>
          <p className="mono mt-1 text-[11px] uppercase tracking-wider text-ink/55">
            {run.startedAt !== null ? formatWhen(run.startedAt) : 'not started'} · limit {run.limit}{' '}
            · {run.language}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Chip variant={statusVariant(run.status)}>{run.status}</Chip>
          {stoppable && (
            <Button variant="secondary" onClick={() => cancel.mutate()} busy={cancel.isPending}>
              Stop this search
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-x-8 sm:grid-cols-2">
        <ComparisonRow label="Results" value={`${run.leadsFound} found · ${run.leadsNew} new`} />
        <ComparisonRow label="Audits" value={`${run.auditsOk} ok · ${run.auditsFailed} failed`} />
        <ComparisonRow
          label="Drafts"
          value={`${run.draftsLlm} from the model · ${run.draftsFallback} template`}
        />
        <ComparisonRow
          label="Cost"
          value={`${run.serpapiCalls} API calls · ${run.tokensIn}/${run.tokensOut} tokens`}
        />
      </div>

      {/*
       * A cancelled run stopped early on purpose, so its counters are smaller
       * than they look and the row says why. Without this, a stopped search is
       * indistinguishable from one that found nothing.
       */}
      {run.status === 'cancelled' && (
        <p className="border-t border-ink/20 bg-paper-band px-5 py-3 text-[14px] text-ink/80">
          Stopped before it finished. The leads it had already found and checked are kept; the rest
          were never looked at.
        </p>
      )}

      {run.error !== null && (
        <p className="border-t border-ink/20 bg-red/5 px-5 py-3 text-[14px] text-red">
          {run.error}
        </p>
      )}

      {cancel.isError && (
        <p className="border-t border-ink/20 bg-red/5 px-5 py-3 text-[14px] text-red">
          {cancel.error instanceof Error ? cancel.error.message : 'Could not stop the search.'}
        </p>
      )}
    </Card>
  );
}

/** Status colours follow the funnel: green when it worked, red when it did not. */
export function statusVariant(
  status: RunStatus,
): 'status-won' | 'finding' | 'status-lost' | 'neutral' {
  if (status === 'completed') return 'status-won';
  if (status === 'failed') return 'status-lost';
  if (status === 'running' || status === 'queued') return 'finding';
  return 'neutral';
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  // A run list is read days later, so the year matters more than the hour.
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
