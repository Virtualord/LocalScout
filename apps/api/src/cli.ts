import { createEventEmitter, type RunEvent } from '@localscout/core';
import { findAndAuditLeads, setWorkflowDeps } from './mastra/workflows/find-and-audit-leads.js';
import { boot, pipelineDeps } from './runtime.js';
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

  const runtime = boot(process.env, { prettyLogs: false });

  // One active run at a time, matching the API's rule, so the CLI cannot start
  // a second run that would interleave database writes with the first.
  const active = await runtime.repos.runs.activeRun();
  if (active) {
    process.stderr.write(
      `A run is already in progress (started ${active.startedAt?.toISOString() ?? 'unknown'}). Wait for it to finish, or cancel it first.\n`,
    );
    runtime.close();
    process.exit(1);
  }

  const runRow = await runtime.repos.runs.create(args);

  const emit = createEventEmitter(runRow.id, (event: RunEvent) => {
    if (
      event.type === 'run.started' ||
      event.type === 'run.finished' ||
      event.type === 'run.failed'
    ) {
      process.stdout.write(`${event.message ?? event.type}\n`);
      return;
    }
    if (VERBOSE_EVENTS.has(event.type)) {
      process.stdout.write(`  ${event.message ?? event.type}\n`);
    }
  });

  setWorkflowDeps(pipelineDeps(runtime, emit));

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
  }
  process.stdout.write(`Open http://localhost:5173/leads to review them.\n`);

  runtime.close();
  process.exit(summary.status === 'failed' ? 1 : 0);
}

await main();
