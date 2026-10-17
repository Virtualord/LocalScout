import { createEventEmitter, type Language } from '@localscout/core';
import type { RunStatus } from '@localscout/core';
import {
  clearWorkflowDeps,
  findAndAuditLeads,
  setWorkflowDeps,
} from './mastra/workflows/find-and-audit-leads.js';
import { publish } from './run-events.js';
import { pipelineDeps, type AppRuntime } from './runtime.js';

/**
 * Run ownership.
 *
 * Localscout allows one run at a time: two would interleave their database
 * writes and spend the SerpApi quota twice on the same search. This module is
 * the single place that decides whether a run may start, and the single place
 * that knows which run this process is currently carrying. The request handler
 * and the scheduler both go through it, so the two cannot drift into applying
 * different rules to the same database.
 */

export interface RunRequest {
  query: string;
  location: string;
  limit: number;
  language: Language;
}

export type ClaimResult =
  { started: true; runId: string } | { started: false; activeRunId: string };

export type CancelResult =
  | { cancelled: true }
  | { cancelled: false; reason: 'not_found' }
  | { cancelled: false; reason: 'already_ended'; status: RunStatus };

/**
 * The runs this process is carrying, with the switch that stops each one.
 *
 * Held in memory rather than in SQLite because it is a handle on a live task
 * inside this process. A run whose process has stopped has no controller
 * anywhere, and cancelling that one is a database write and nothing more.
 */
const activeRuns = new Map<string, AbortController>();

/** Runs this process is carrying right now. Used by tests and the scheduler. */
export function activeRunIds(): string[] {
  return [...activeRuns.keys()];
}

/**
 * A queue of one, over the check-then-start.
 *
 * `activeRun()` and `create()` are separate statements, so two requests landing
 * together could both see no active run and both start one. Serialising the pair
 * means the second waits for the first to have written its row, and then
 * correctly finds it.
 */
let gate: Promise<unknown> = Promise.resolve();

function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = gate.then(work, work);
  // The chain has to survive a rejection, or one failed start would wedge the
  // queue for the life of the process.
  gate = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Take the active-run slot and begin.
 *
 * Resolves as soon as the run row exists; the work continues in the background
 * and reports over the event stream. `started: false` means another run holds
 * the slot, and names it so the caller can say which.
 */
export function claimRun(runtime: AppRuntime, input: RunRequest): Promise<ClaimResult> {
  return serialised(async () => {
    const active = await runtime.repos.runs.activeRun();
    if (active) return { started: false as const, activeRunId: active.id };

    const runRow = await runtime.repos.runs.create(input);
    const controller = new AbortController();
    activeRuns.set(runRow.id, controller);

    const emit = createEventEmitter(runRow.id, publish);
    setWorkflowDeps(runRow.id, pipelineDeps(runtime, emit, controller.signal));

    // Not awaited: the caller returns as soon as the row exists.
    void (async () => {
      try {
        const run = await findAndAuditLeads.createRun();
        await run.start({ inputData: { runId: runRow.id, ...input } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.logger.error({ runId: runRow.id, err: error }, 'run.crashed');

        try {
          await runtime.repos.runs.setStatus(runRow.id, 'failed', message);
        } catch (recordError) {
          /*
           * Recording a failure must not itself fail. The database can already
           * be gone — a process shutting down, a test tearing down — and an
           * unhandled rejection here would end the process, turning a run that
           * failed into an API that died.
           */
          runtime.logger.error({ runId: runRow.id, err: recordError }, 'run.crash_unrecorded');
        }

        publish({
          type: 'run.failed',
          runId: runRow.id,
          at: new Date().toISOString(),
          message: `Run failed: ${message}`,
        });
      } finally {
        // Both registries are keyed by run id and neither is allowed to grow
        // with the number of runs the process has ever served.
        activeRuns.delete(runRow.id);
        clearWorkflowDeps(runRow.id);
      }
    })();

    return { started: true as const, runId: runRow.id };
  });
}

/**
 * Stop a run.
 *
 * The database write is the cancel: it is what the UI reads, what the events
 * stream reports, and what frees the active-run slot. The abort is a courtesy to
 * a run this process happens to be carrying, and it is cooperative, so an audit
 * already in flight still finishes and is still recorded truthfully.
 */
export async function cancelRun(runtime: AppRuntime, runId: string): Promise<CancelResult> {
  const run = await runtime.repos.runs.byId(runId);
  if (!run) return { cancelled: false, reason: 'not_found' };
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return { cancelled: false, reason: 'already_ended', status: run.status };
  }

  await runtime.repos.runs.setStatus(runId, 'cancelled');
  activeRuns.get(runId)?.abort();

  publish({
    type: 'run.cancelled',
    runId,
    at: new Date().toISOString(),
    message: 'Stopped.',
  });

  return { cancelled: true };
}

/**
 * Fail every run left behind by a process that is no longer there.
 *
 * Called once at API startup. A run lives inside the process that started it, so
 * at boot any row still marked `queued` or `running` belongs to a process that
 * has stopped: a crash, a `kill -9`, or a dev-server restart. Nothing else would
 * ever clear it, and because only one run may be active at a time, that row
 * would refuse every future search for the life of the database.
 *
 * Deliberately not called from the CLI. The API may legitimately be carrying a
 * run while a short-lived command starts, and a command has no standing to
 * declare another process's work dead.
 */
export async function reconcileInterruptedRuns(runtime: AppRuntime): Promise<number> {
  const interrupted = await runtime.repos.runs.failInterruptedRuns(
    'The process running this search stopped before it finished.',
  );

  if (interrupted > 0) {
    runtime.logger.warn(
      { interrupted },
      'run.reaped_interrupted_runs: a previous process stopped mid-search',
    );
  }

  return interrupted;
}
