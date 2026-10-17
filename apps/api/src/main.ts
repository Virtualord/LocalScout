import { boot } from './runtime.js';
import { createApp, startServer } from './app.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerRunRoutes } from './routes/runs.js';
import { findAndAuditLeads, setWorkflowDeps } from './mastra/workflows/find-and-audit-leads.js';
import { createEventEmitter, startScheduler } from '@localscout/core';
import { pipelineDeps } from './runtime.js';

/**
 * Explain a startup failure in words.
 *
 * `startServer` rejects with the raw Node error, and at the top level that used
 * to surface as an unhandled rejection: a stack trace about
 * `Server.setupListenHandle`, which tells a developer nothing about what to do.
 * A port already in use is the most common first-run failure after a bad
 * `.env`, so it gets the same treatment as a configuration error.
 *
 * Returns the message rather than calling `process.exit`, so it can be asserted
 * in a test without killing the test runner.
 */
export function describeStartupError(error: unknown, port: number): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  if (code === 'EADDRINUSE') {
    return [
      '',
      `Port ${port} is already in use, so the API cannot start.`,
      '',
      'Another Localscout process is probably still running. Find it and stop it:',
      '',
      `  lsof -ti tcp:${port} | xargs kill`,
      '',
      'Or start on a different port:',
      '',
      `  API_PORT=${port + 1} pnpm dev`,
      '',
    ].join('\n');
  }

  if (code === 'EACCES') {
    return [
      '',
      `Not allowed to bind port ${port}.`,
      '',
      'On Linux, ports below 1024 need elevated privileges. Localscout defaults to',
      `8787, so this usually means something overrode it. Try: API_PORT=8788 pnpm dev`,
      '',
    ].join('\n');
  }

  // Anything else still gets a plain line rather than a stack trace, and the
  // stack goes to the logger where it belongs.
  const message = error instanceof Error ? error.message : String(error);
  return `\nThe API could not start: ${message}\n`;
}

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

/*
 * A startup failure exits with a message, not a stack trace.
 *
 * `boot` handles a bad `.env` this way already; a port clash is the next most
 * common way for `pnpm dev` to fail on a fresh machine, so it gets the same
 * treatment. Anything unforeseen is still logged in full for debugging.
 */
try {
  await main();
} catch (error) {
  const port = Number(process.env['API_PORT'] ?? 8787);
  process.stderr.write(describeStartupError(error, port));
  process.exitCode = 1;
}
