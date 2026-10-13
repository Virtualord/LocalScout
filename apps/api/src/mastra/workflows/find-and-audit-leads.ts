import { createWorkflow } from '@mastra/core/workflows';
import { executeRunStep, runInputSchema, runResultSchema } from '../steps/execute-run.js';

/**
 * `findAndAuditLeads`
 *
 * A typed Mastra workflow whose single step delegates to the tested pipeline in
 * `@localscout/core`. Mastra owns the run handle and the typed contract; the
 * sequencing, concurrency and event emission live in tested pure code.
 */
export const findAndAuditLeads = createWorkflow({
  id: 'findAndAuditLeads',
  inputSchema: runInputSchema,
  outputSchema: runResultSchema,
})
  .then(executeRunStep)
  .commit();

export type FindAndAuditLeadsWorkflow = typeof findAndAuditLeads;

export {
  executeRunStep,
  getDeps,
  setWorkflowDeps,
  runInputSchema,
  runResultSchema,
  type RunInput,
  type RunResult,
} from '../steps/execute-run.js';
