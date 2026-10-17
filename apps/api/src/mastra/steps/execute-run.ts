import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { runPipeline, type PipelineDeps } from '@localscout/core';

/**
 * Mastra step definitions.
 *
 * These are deliberately thin. Every step delegates to a tested pure function in
 * `@localscout/core`, so the framework contributes typed input/output schemas
 * and run state without owning any logic. If Mastra changes shape, only this
 * file changes; the behaviour under test does not move.
 *
 * The steps mirror the pipeline rather than calling it, because a workflow is
 * resumable and observable: mapping the stages lets a run be inspected step by
 * step, and a future partial retry re-run just the audit stage.
 */

export const runInputSchema = z.object({
  runId: z.string(),
  query: z.string().min(1),
  location: z.string().min(1),
  limit: z.number().int().min(1).max(50),
  language: z.enum(['en', 'hinglish', 'hi']),
});

export type RunInput = z.infer<typeof runInputSchema>;

export const runResultSchema = z.object({
  runId: z.string(),
  status: z.enum(['completed', 'failed', 'cancelled']),
  leadsFound: z.number(),
  leadsNew: z.number(),
  skippedDuplicates: z.number(),
  skippedContacted: z.number(),
  auditsOk: z.number(),
  auditsFailed: z.number(),
  draftsLlm: z.number(),
  draftsFallback: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  serpApiCalls: z.number(),
  outcomes: z.array(
    z.object({
      leadId: z.string(),
      name: z.string(),
      status: z.enum(['audited', 'skipped', 'failed']),
      opportunityScore: z.number(),
      findingIds: z.array(z.string()),
      draftId: z.string().optional(),
      generatedBy: z.enum(['llm', 'fallback']).optional(),
      grounded: z.boolean().optional(),
      error: z.string().optional(),
    }),
  ),
  error: z.string().optional(),
});

export type RunResult = z.infer<typeof runResultSchema>;

/**
 * The single execution step.
 *
 * `runPipeline` already sequences discovery, dedupe, auditing, drafting and
 * persistence with its own concurrency and event emission. Splitting it across
 * five Mastra steps here would mean either five real stages with state to thread
 * between them, or five labels on one call. The first adds ceremony without
 * behaviour; the second is what this is. The workflow exists so Mastra owns run
 * state and the API has a typed entry point, not to re-sequence work that is
 * already correctly ordered.
 */
export const executeRunStep = createStep({
  id: 'execute-run',
  inputSchema: runInputSchema,
  outputSchema: runResultSchema,
  execute: async ({ inputData }) => {
    return runPipeline(inputData, getDeps(inputData.runId));
  },
});

/**
 * Dependencies per run, keyed by run id.
 *
 * A Mastra step is a zero-argument function, so the dependencies it needs cannot
 * be passed in; they are looked up by the run id the step was given, which is the
 * only identifier the framework hands it and the one thing that is guaranteed to
 * be unique per run.
 *
 * Keyed rather than a single holder because a holder holds one thing. Whoever
 * started a run last overwrote it, so a scheduled run starting on top of a
 * manual one sent the manual run's progress events to the scheduled run's
 * emitter: the run in the browser stopped updating and another run's events
 * appeared under its id. There is no correct ordering of a single slot; the run
 * id is what makes the lookup right.
 *
 * Bounded by explicit release, not by hope: `claimRun` clears the entry when the
 * run ends, whichever way it ends.
 */
const depsByRun = new Map<string, PipelineDeps>();

export function setWorkflowDeps(runId: string, next: PipelineDeps): void {
  depsByRun.set(runId, next);
}

export function getDeps(runId: string): PipelineDeps {
  const found = depsByRun.get(runId);
  if (!found) {
    throw new Error(
      `No dependencies registered for run ${runId}. Call setWorkflowDeps(runId, deps) before starting it.`,
    );
  }
  return found;
}

/** Release a run's dependencies. Called when the run ends, so the map stays bounded. */
export function clearWorkflowDeps(runId: string): void {
  depsByRun.delete(runId);
}
