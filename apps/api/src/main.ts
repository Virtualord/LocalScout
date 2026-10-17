import { pathToFileURL } from 'node:url';
import { boot } from './runtime.js';
import { createApp, startServer } from './app.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerRunRoutes } from './routes/runs.js';
import { ConfigError, startScheduler } from '@localscout/core';
import { claimRun, reconcileInterruptedRuns } from './run-control.js';

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
  if (error instanceof ConfigError) {
    // A configuration error is the most common first-run failure of all, so it
    // is printed as a sentence about what to fix, never as a stack trace.
    return `\n${error.message}\n\n`;
  }

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

  /*
   * A run lives inside the process that started it, so at startup anything still
   * marked `queued` or `running` belongs to a process that is no longer there: a
   * crash, a `kill -9`, or a dev-server restart. Reaping it here is what stops a
   * crash from refusing every future search, because only one run may be active
   * at a time and nothing else would ever clear the row.
   */
  await reconcileInterruptedRuns(runtime);

  const app = createApp(runtime);

  registerHealthRoutes(app, runtime);
  registerRunRoutes(app, runtime);
  registerLeadRoutes(app, runtime);

  const server = await startServer(runtime, app);
  runtime.logger.info({ port: server.port }, 'api.listening');

  process.stdout.write(`\nLocalscout API on http://127.0.0.1:${server.port}\n`);
  process.stdout.write(
    `Discovery: ${runtime.config.discovery.mode}, drafts: ${runtime.config.llm.provider}\n`,
  );

  if (runtime.config.scheduler.enabled) {
    const scheduler = await startScheduler({
      repos: runtime.repos,
      /*
       * Through `claimRun` rather than straight to the workflow, so a scheduled
       * search obeys the same one-at-a-time rule and the same event wiring as a
       * manual one. Starting it directly also meant a failure here left a row
       * marked `running` with nobody left to close it, which then refused every
       * later search until the process was restarted.
       */
      startRun: async (input) => {
        const claimed = await claimRun(runtime, input);
        if (!claimed.started) {
          runtime.logger.warn({ runId: claimed.activeRunId }, 'scheduler.skipped_run_in_progress');
        }
      },
      logger: runtime.logger,
    });
    runtime.logger.info({ tasks: scheduler.taskCount }, 'scheduler.started');
  }

  const shutdown = async (): Promise<void> => {
    process.stdout.write('\nShutting down.\n');
    await server.close();

    /*
     * Anything still marked running belongs to this process, which is stopping.
     * Reaping it here rather than waiting for the next boot means the database
     * is left clean: otherwise the next search is refused until an API restart,
     * for no reason a user could see.
     */
    await reconcileInterruptedRuns(runtime);

    runtime.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

/*
 * A startup failure exits with a message, not a stack trace.
 *
 * `boot` throws a `ConfigError` for a bad `.env`, which `describeStartupError`
 * renders as a sentence; a port clash is the next most common way for
 * `pnpm dev` to fail on a fresh machine and gets the same treatment. Anything
 * unforeseen is still logged in full for debugging.
 *
 * Only when this file is the program, not when it is imported. `main.test.ts`
 * imports `describeStartupError` from here, and without this guard that import
 * boots an entire API: it binds the port, reaps interrupted runs in whatever
 * database the environment points at, and starts the scheduler. A unit test
 * asserting a startup message must not start the server the message is about.
 */
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  try {
    await main();
  } catch (error) {
    const port = Number(process.env['API_PORT'] ?? 8787);
    process.stderr.write(describeStartupError(error, port));
    process.exitCode = 1;
  }
}
