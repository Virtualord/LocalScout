import { streamSSE } from 'hono/streaming';
import type { Hono } from 'hono';
import { z } from 'zod';
import { createEventEmitter, type Language, type RunEvent } from '@localscout/core';
import type { AppRuntime } from '../runtime.js';
import { pipelineDeps } from '../runtime.js';
import { findAndAuditLeads, setWorkflowDeps } from '../mastra/workflows/find-and-audit-leads.js';

/**
 * Run endpoints, including the SSE progress stream.
 *
 * The stream is the reason a run is usable: a 50-lead audit is minutes of real
 * network waiting, and a spinner with no explanation is worse than no feedback.
 * Every stage emits an event the UI can render as a line of plain progress.
 *
 * One run at a time. Two concurrent runs would interleave their database
 * writes and double the SerpApi spend for the same search, so a second request
 * is refused with a message naming the run in progress.
 */

const runRequestSchema = z.object({
  query: z.string().trim().min(1, 'Enter a business type, for example "plumbers".').max(120),
  location: z.string().trim().min(1, 'Enter a city, for example "Bhopal".').max(120),
  limit: z.number().int().min(1).max(50).default(20),
  language: z.enum(['en', 'hinglish', 'hi']).default('en'),
});

/** Recent events per run, so a client that connects late still sees context. */
const eventBuffer = new Map<string, RunEvent[]>();
const MAX_BUFFERED_EVENTS = 500;

export function recordEvent(event: RunEvent): void {
  const existing = eventBuffer.get(event.runId) ?? [];
  existing.push(event);
  // Bounded so a long run cannot grow this without limit.
  eventBuffer.set(event.runId, existing.slice(-MAX_BUFFERED_EVENTS));
}

export function eventsFor(runId: string): RunEvent[] {
  return eventBuffer.get(runId) ?? [];
}

/** Live sinks per run, so the API can push to a connected browser. */
const subscribers = new Map<string, Set<(event: RunEvent) => void>>();

export function subscribe(runId: string, sink: (event: RunEvent) => void): () => void {
  const set = subscribers.get(runId) ?? new Set();
  set.add(sink);
  subscribers.set(runId, set);

  return () => {
    set.delete(sink);
    if (set.size === 0) subscribers.delete(runId);
  };
}

export function publish(event: RunEvent): void {
  recordEvent(event);
  for (const sink of subscribers.get(event.runId) ?? []) {
    try {
      sink(event);
    } catch {
      // A disconnected client must not break the run.
    }
  }
}

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

    const active = await repos.runs.activeRun();
    if (active) {
      return c.json(
        {
          error: `A search is already running. Wait for it to finish, or cancel it from the Runs screen.`,
          runId: active.id,
        },
        409,
      );
    }

    const input = parsed.data;
    const runRow = await repos.runs.create(input);

    const emit = createEventEmitter(runRow.id, publish);

    // The workflow reads its dependencies from the module holder the step
    // installs at boot; setting it here keeps the API and the CLI identical.
    setWorkflowDeps(pipelineDeps(runtime, emit));

    // Started, not awaited: the request returns immediately and the browser
    // follows progress over SSE.
    void (async () => {
      try {
        const run = await findAndAuditLeads.createRun();
        await run.start({
          inputData: { runId: runRow.id, ...input, language: input.language as Language },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.logger.error({ runId: runRow.id, err: error }, 'run.crashed');
        await repos.runs.setStatus(runRow.id, 'failed', message);
        publish({
          type: 'run.failed',
          runId: runRow.id,
          at: new Date().toISOString(),
          message: `Run failed: ${message}`,
        });
      }
    })();

    return c.json({ runId: runRow.id }, 202);
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

      // Already finished: the replay above carried the terminal event.
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return;
      }

      const unsubscribe = subscribe(runId, (event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event), id: event.at });
        if (event.type === 'run.finished' || event.type === 'run.failed') {
          unsubscribe();
        }
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
        const poll = setInterval(async () => {
          const current = await repos.runs.byId(runId);
          if (
            !current ||
            current.status === 'completed' ||
            current.status === 'failed' ||
            current.status === 'cancelled'
          ) {
            clearInterval(poll);
            finish();
          }
        }, 1000);

        stream.onAbort(() => {
          clearInterval(poll);
          finish();
        });
      });
    });
  });
}
