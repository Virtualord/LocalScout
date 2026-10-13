/**
 * Run progress events.
 *
 * The API streams these over SSE so the UI can show a run as it happens rather
 * than after it finishes. Every event carries the run id, and lead-scoped events
 * also carry the lead id, so a consumer can route them without parsing text.
 *
 * Events are emitted, never awaited: a slow or disconnected consumer must never
 * stall a run.
 */

export type RunEventName =
  | 'run.started'
  | 'lead.discovered'
  | 'lead.skipped'
  | 'audit.started'
  | 'audit.finished'
  | 'draft.finished'
  | 'run.finished'
  | 'run.failed';

export interface RunEvent {
  type: RunEventName;
  runId: string;
  at: string;
  leadId?: string;
  /** Short, human-readable line for the progress list. */
  message?: string;
  /** Structured detail, shaped per event type. */
  data?: Record<string, unknown>;
}

export type EventSink = (event: RunEvent) => void;

/** Emitter bound to one run. */
export type Emit = (event: Omit<RunEvent, 'runId' | 'at'>) => void;

/**
 * Build the emitter for one run.
 *
 * The sink defaults to a no-op so the pipeline can run in a test or a CLI
 * invocation with no listener attached.
 */
export function createEventEmitter(runId: string, sink?: EventSink): Emit {
  return (event) => {
    const full: RunEvent = { ...event, runId, at: new Date().toISOString() };
    try {
      sink?.(full);
    } catch {
      // A broken consumer is not a run failure. The run continues; a dropped
      // progress line is preferable to aborting measured work.
    }
  };
}

/**
 * An emitter that records everything, for tests and for the CLI summary.
 *
 * Takes the run id so recorded events carry the same value a live sink would,
 * which is what lets a test assert that every event is attributable.
 */
export function recordingEmitter(runId = 'test-run'): { emit: Emit; events: RunEvent[] } {
  const events: RunEvent[] = [];
  const emit: Emit = (event) => {
    events.push({ ...event, runId, at: new Date().toISOString() });
  };
  return { emit, events };
}
