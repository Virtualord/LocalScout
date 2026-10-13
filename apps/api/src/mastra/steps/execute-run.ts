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
  status: z.enum(['completed', 'failed']),
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
    const deps = getDeps();
    return runPipeline(inputData, deps);
  },
});

/**
 * Dependencies for the workflow.
 *
 * Set once at boot by the API and the CLI. A module-level holder rather than a
 * parameter is what lets a Mastra step stay a zero-argument function, which is
 * the shape the framework requires.
 */
let deps: PipelineDeps | undefined;

export function setWorkflowDeps(next: PipelineDeps): void {
  deps = next;
}

export function getDeps(): PipelineDeps {
  if (!deps) {
    throw new Error(
      'Workflow dependencies were not set. Call setWorkflowDeps() during boot, before starting a run.',
    );
  }
  return deps;
}
