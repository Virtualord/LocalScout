import { pathToFileURL } from 'node:url';
import { boot } from './runtime.js';
import { createApp, startServer } from './app.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerRunRoutes } from './routes/runs.js';
import { startScheduler } from '@localscout/core';
import { claimRun, reconcileInterruptedRuns } from './run-control.js';
import { describeStartupError } from './startup-error.js';

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
 * Only when this file is the program, not when it is imported. An import must
 * never boot a server: it would bind the port, reap interrupted runs in whatever
 * database the environment points at, and start the scheduler. That is not
 * hypothetical — the startup message helper used to live in this file, and the
 * test that imported it booted a whole API as a side effect. The helper has
 * moved to `startup-error.ts`, and this guard stays so the next import cannot
 * repeat it: an entrypoint is a program, not a library.
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
