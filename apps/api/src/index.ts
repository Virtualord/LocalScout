/**
 * Public surface of the API package.
 *
 * The Mastra workflow lives in `mastra/`, the wiring in `runtime.ts`, and the
 * domain logic in `@localscout/core`. This file re-exports what the server, the
 * CLI and the tests need so none of them reach into the mastra directory.
 */
export {
  findAndAuditLeads,
  getDeps,
  setWorkflowDeps,
  runInputSchema,
  runResultSchema,
  executeRunStep,
  type RunInput,
  type RunResult,
} from './mastra/workflows/find-and-audit-leads.js';

export {
  boot,
  createProvider,
  loadSenderProfile,
  pipelineDeps,
  type AppRuntime,
  type BootOptions,
} from './runtime.js';

export { CLI_USAGE, CliUsageError, parseCliArgs, type CliArgs } from './cli-args.js';
