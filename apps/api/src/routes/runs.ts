import { streamSSE } from 'hono/streaming';
import type { Hono } from 'hono';
import { z } from 'zod';
import { isRunFinished } from '@localscout/core';
import type { AppRuntime } from '../runtime.js';
import { cancelRun, claimRun } from '../run-control.js';
import { eventsFor, isTerminalEvent, subscribe } from '../run-events.js';

/**
 * Run endpoints, including the SSE progress stream.
 *
 * The stream is the reason a run is usable: a 50-lead audit is minutes of real
 * network waiting, and a spinner with no explanation is worse than no feedback.
 * Every stage emits an event the UI can render as a line of plain progress.
 *
 * One run at a time. Two concurrent runs would interleave their database writes
 * and double the SerpApi spend for the same search, so a second request is
 * refused with a message naming the run in progress. The decision itself belongs
 * to `run-control.ts`, because the scheduler has to obey the same rule.
 */

const runRequestSchema = z.object({
  query: z.string().trim().min(1, 'Enter a business type, for example "plumbers".').max(120),
  location: z.string().trim().min(1, 'Enter a city, for example "Bhopal".').max(120),
  limit: z.number().int().min(1).max(50).default(20),
  language: z.enum(['en', 'hinglish', 'hi']).default('en'),
});

export function registerRunRoutes(app: Hono, runtime: AppRuntime): void {
  const { repos } = runtime;

  app.post('/api/runs', async (c) => {
    const parsed = runRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: 'Check the search details.',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
        },
        400,
      );
    }

    const claimed = await claimRun(runtime, parsed.data);
    if (!claimed.started) {
      return c.json(
        {
          error: `A search is already running. Wait for it to finish, or stop it from the Runs screen.`,
          runId: claimed.activeRunId,
        },
        409,
      );
    }

    return c.json({ runId: claimed.runId }, 202);
  });

  /**
   * Stop a run.
   *
   * Without this the 409 above was a dead end: the message offered a way out
   * that did not exist, and a run whose process died held the slot forever.
   * Cancelling is cooperative, so an audit already in flight finishes and is
   * recorded; everything after it is not started.
   */
  app.post('/api/runs/:id/cancel', async (c) => {
    const runId = c.req.param('id');
    const result = await cancelRun(runtime, runId);

    if (!result.cancelled) {
      if (result.reason === 'not_found') {
        return c.json({ error: `No run with id ${runId}.` }, 404);
      }
      if (result.status === 'cancelled') {
        return c.json({ run: await repos.runs.requireById(runId) });
      }
      return c.json(
        {
          error: `That search already ended as "${result.status}".`,
          run: await repos.runs.byId(runId),
        },
        409,
      );
    }

    return c.json({ run: await repos.runs.requireById(runId) });
  });

  app.get('/api/runs', async (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    const rows = await repos.runs.list(Number.isInteger(limit) ? Math.min(limit, 200) : 50);
    return c.json({ runs: rows });
  });

  app.get('/api/runs/:id', async (c) => {
    const run = await repos.runs.byId(c.req.param('id'));
    if (!run) return c.json({ error: `No run with id ${c.req.param('id')}.` }, 404);
    return c.json({ run });
  });

  app.get('/api/runs/:id/events', (c) => {
    const runId = c.req.param('id');

    return streamSSE(c, async (stream) => {
      let closed = false;

      /*
       * Two abort listeners, and both of them run: Hono pushes each callback
       * onto an `abortSubscribers` list rather than replacing the last one. The
       * first stops the replay loop below, the second settles the wait and
       * clears its timers.
       */
      stream.onAbort(() => {
        closed = true;
      });

      // Replay what already happened, so a client that connects after the run
      // started still has the full picture instead of only the tail.
      for (const event of eventsFor(runId)) {
        if (closed) return;
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event), id: event.at });
      }

      const run = await repos.runs.byId(runId);
      if (!run) {
        await stream.writeSSE({
          event: 'run.failed',
          data: JSON.stringify({ type: 'run.failed', runId, message: 'No such run.' }),
        });
        return;
      }

      // Already finished: the replay above carried the terminal event if it is
      // still buffered, and the run row itself has the counters either way.
      if (isRunFinished(run.status)) return;

      const unsubscribe = subscribe(runId, (event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event), id: event.at });
        if (isTerminalEvent(event)) unsubscribe();
      });

      // Heartbeat: a proxy or an idle browser will otherwise drop a quiet
      // connection mid-run without either side noticing.
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: JSON.stringify({ at: Date.now() }) });
      }, 15_000);

      await new Promise<void>((resolve) => {
        const finish = () => {
          clearInterval(heartbeat);
          unsubscribe();
          resolve();
        };

        const poll = setInterval(() => {
          void (async () => {
            try {
              const current = await repos.runs.byId(runId);
              if (!current || isRunFinished(current.status)) {
                clearInterval(poll);
                finish();
              }
            } catch (error) {
              /*
               * A failed read must not become an unhandled rejection: Node ends
               * the process on one, so a transient database error would take the
               * API down instead of closing a stream. The stream is closed and
               * the client's next load reads the run's recorded state.
               */
              runtime.logger.warn({ runId, err: error }, 'run.events_poll_failed');
              clearInterval(poll);
              finish();
            }
          })();
        }, 1000);

        stream.onAbort(() => {
          clearInterval(poll);
          finish();
        });
      });
    });
  });
}
