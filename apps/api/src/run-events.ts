import type { RunEvent } from '@localscout/core';

/**
 * The run event bus.
 *
 * Two things, kept apart on purpose: a short replay buffer so a browser that
 * connects a second late still gets the whole story, and live sinks so an
 * already-connected browser is pushed to rather than polled. The stream is the
 * reason a run is usable at all; a 50-lead audit is minutes of real network
 * waiting, and a spinner that explains nothing is worse than no spinner.
 *
 * Nothing here ever throws into the pipeline. A disconnected client is not a
 * reason for a run to fail.
 */

interface BufferedRun {
  events: RunEvent[];
  /**
   * When the run's terminal event arrived, or null while it is still going.
   *
   * This is the clock for eviction. A run in progress is never a candidate,
   * however old it is, because its events are the ones a client is watching for.
   */
  finishedAt: number | null;
}

const eventBuffer = new Map<string, BufferedRun>();

/** Per-run cap. A progress list does not need more than this many lines. */
const MAX_BUFFERED_EVENTS = 500;

/** How long a finished run's events stay replayable, for a browser that reconnects. */
const FINISHED_BUFFER_TTL_MS = 5 * 60 * 1000;

/** A ceiling on finished runs kept, so a busy week cannot grow this map. */
const MAX_FINISHED_BUFFERS = 20;

const TERMINAL_EVENTS: ReadonlySet<RunEvent['type']> = new Set([
  'run.finished',
  'run.failed',
  'run.cancelled',
]);

/**
 * Drop finished runs' events once they are stale.
 *
 * The per-run cap bounded one run's buffer and nothing else: the key itself was
 * never removed, so every run ever made left its events in this map for the life
 * of the process. A run's events are only needed until the browsers watching it
 * have arrived, so they are held for a grace window and then released, with a
 * count cap so a burst of runs cannot hold the window open on its own.
 */
function evictFinishedBuffers(now: number): void {
  for (const [runId, entry] of eventBuffer) {
    if (entry.finishedAt !== null && entry.finishedAt < now - FINISHED_BUFFER_TTL_MS) {
      eventBuffer.delete(runId);
    }
  }

  const finished = [...eventBuffer].filter(([, entry]) => entry.finishedAt !== null);
  if (finished.length <= MAX_FINISHED_BUFFERS) return;

  finished
    .sort((a, b) => (a[1].finishedAt ?? 0) - (b[1].finishedAt ?? 0))
    .slice(0, finished.length - MAX_FINISHED_BUFFERS)
    .forEach(([runId]) => eventBuffer.delete(runId));
}

export function recordEvent(event: RunEvent): void {
  const entry = eventBuffer.get(event.runId) ?? { events: [], finishedAt: null };

  entry.events.push(event);
  entry.events = entry.events.slice(-MAX_BUFFERED_EVENTS);
  if (TERMINAL_EVENTS.has(event.type)) entry.finishedAt = Date.now();

  eventBuffer.set(event.runId, entry);
  evictFinishedBuffers(entry.finishedAt ?? Date.now());
}

/** The events of a run that are still buffered, oldest first. */
export function eventsFor(runId: string): RunEvent[] {
  return eventBuffer.get(runId)?.events ?? [];
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
      // A sink that throws is a disconnected client, not a broken run.
    }
  }
}

/** True when this event means the run has stopped, whichever way it stopped. */
export function isTerminalEvent(event: RunEvent): boolean {
  return TERMINAL_EVENTS.has(event.type);
}
