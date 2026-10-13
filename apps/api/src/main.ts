import { boot } from './runtime.js';
import { createApp, startServer } from './app.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerRunRoutes } from './routes/runs.js';
import { findAndAuditLeads, setWorkflowDeps } from './mastra/workflows/find-and-audit-leads.js';
import { createEventEmitter, startScheduler } from '@localscout/core';
import { pipelineDeps } from './runtime.js';

/**
 * `pnpm dev:api`
 *
 * Boots the local API on 127.0.0.1:8787.
 */
async function main(): Promise<void> {
  const runtime = boot(process.env, { prettyLogs: true });

  const app = createApp(runtime);

  registerHealthRoutes(app, runtime);
  registerRunRoutes(app, runtime);
  registerLeadRoutes(app, runtime);

  // The workflow needs its dependencies before any run starts. The run routes
  // set them per run with the right event sink; this installs a default so the
  // workflow is never unconfigured, which would throw on first use.
  setWorkflowDeps(pipelineDeps(runtime, createEventEmitter('boot')));

  const server = await startServer(runtime, app);
  runtime.logger.info({ port: server.port }, 'api.listening');

  process.stdout.write(`\nLocalscout API on http://127.0.0.1:${server.port}\n`);
  process.stdout.write(
    `Discovery: ${runtime.config.discovery.mode}, drafts: ${runtime.config.llm.provider}\n`,
  );

  if (runtime.config.scheduler.enabled) {
    const scheduler = await startScheduler({
      repos: runtime.repos,
      startRun: async (input) => {
        const runRow = await runtime.repos.runs.create(input);
        const emit = createEventEmitter(runRow.id);
        setWorkflowDeps(pipelineDeps(runtime, emit));
        const run = await findAndAuditLeads.createRun();
        await run.start({ inputData: { runId: runRow.id, ...input } });
      },
      logger: runtime.logger,
    });
    runtime.logger.info({ tasks: scheduler.taskCount }, 'scheduler.started');
  }

  const shutdown = async (): Promise<void> => {
    process.stdout.write('\nShutting down.\n');
    await server.close();
    runtime.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

await main();
