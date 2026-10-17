import { createEventEmitter, type RunEvent } from '@localscout/core';
import { findAndAuditLeads, setWorkflowDeps } from './mastra/workflows/find-and-audit-leads.js';
import { boot, pipelineDeps, type AppRuntime } from './runtime.js';
import { describeConfigError } from './startup-error.js';
import { CliUsageError, parseCliArgs } from './cli-args.js';

/**
 * `pnpm cli "plumbers" Bhopal`
 *
 * The batch command. It runs the same workflow the API runs, so a run started
 * from a terminal and a run started from the browser produce identical results
 * and identical records. The difference is only where progress is printed.
 */

const VERBOSE_EVENTS = new Set([
  'lead.discovered',
  'lead.skipped',
  'audit.started',
  'audit.finished',
  'draft.finished',
]);

/**
 * Boot, or say what is wrong with the configuration and stop.
 *
 * The CLI never binds a port, so a bad `.env` is the only startup failure it can
 * explain — and `boot` throws it rather than printing it. Without this the throw
 * reached the user as a stack trace about zod internals, which is the least
 * useful possible answer to "I typed the key wrong".
 */
function bootOrExit(): AppRuntime {
  try {
    return boot(process.env, { prettyLogs: false });
  } catch (error) {
    const message = describeConfigError(error);
    if (message === undefined) throw error;
    process.stderr.write(message);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const runtime = bootOrExit();

  // One active run at a time, matching the API's rule, so the CLI cannot start
  // a second run that would interleave database writes with the first.
  const active = await runtime.repos.runs.activeRun();
  if (active) {
    process.stderr.write(
      `A run is already in progress (started ${active.startedAt?.toISOString() ?? 'unknown'}).\n` +
        `Wait for it to finish, or stop it: POST /api/runs/${active.id}/cancel\n`,
    );
    runtime.close();
    process.exit(1);
  }

  const runRow = await runtime.repos.runs.create(args);

  const emit = createEventEmitter(runRow.id, (event: RunEvent) => {
    if (
      event.type === 'run.started' ||
      event.type === 'run.finished' ||
      event.type === 'run.cancelled' ||
      event.type === 'run.failed'
    ) {
      process.stdout.write(`${event.message ?? event.type}\n`);
      return;
    }
    if (VERBOSE_EVENTS.has(event.type)) {
      process.stdout.write(`  ${event.message ?? event.type}\n`);
    }
  });

  /*
   * Ctrl-C stops the run instead of abandoning it.
   *
   * Leaving a row marked `running` would refuse the next search until something
   * reaped it, and only one run may be active at a time. The first signal asks
   * the pipeline to stop at the next lead boundary, which records the run as
   * cancelled; the handlers are `once`, so a second Ctrl-C terminates the process
   * the usual way for a user who does not want to wait for an audit in flight.
   */
  const controller = new AbortController();
  process.once('SIGINT', () => {
    process.stdout.write('\nStopping after the check in flight...\n');
    controller.abort();
  });
  process.once('SIGTERM', () => controller.abort());

  setWorkflowDeps(runRow.id, pipelineDeps(runtime, emit, controller.signal));

  const run = await findAndAuditLeads.createRun();
  const result = await run.start({ inputData: { runId: runRow.id, ...args } });

  // Mastra exposes `result` only on a successful run. Every other status
  // (failed, suspended, tripwire) carries its own payload, and none of them is
  // a completed run, so the CLI reports rather than summarising.
  if (result.status !== 'success') {
    const detail =
      result.status === 'failed' ? result.error.message : `the run ended as "${result.status}"`;
    process.stderr.write(`\nRun did not complete: ${detail}\n`);
    runtime.close();
    process.exit(1);
  }

  const summary = result.result;
  process.stdout.write(
    `\n${summary.leadsNew} new leads, ${summary.auditsOk} audited, ` +
      `${summary.draftsLlm + summary.draftsFallback} drafts ready ` +
      `(${summary.draftsLlm} from the model, ${summary.draftsFallback} from a template).\n`,
  );
  if (summary.status === 'failed') {
    process.stderr.write(`Run reported: ${summary.error ?? 'unknown error'}\n`);
  } else if (summary.status === 'cancelled') {
    process.stdout.write('Stopped early. The leads it already found are kept.\n');
  }
  process.stdout.write(`Open http://localhost:5173/leads to review them.\n`);

  runtime.close();
  // 130 is the conventional exit code for a command stopped by a signal, which
  // is the only way a CLI run ends up cancelled.
  process.exit(summary.status === 'failed' ? 1 : summary.status === 'cancelled' ? 130 : 0);
}

await main();
