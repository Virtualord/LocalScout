import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@localscout/core';
import { eventsFor, isTerminalEvent, publish, recordEvent, subscribe } from './run-events.js';

/**
 * The event bus.
 *
 * The per-run cap was always there; what was missing was eviction. A key was
 * never removed from the buffer, so a long-lived process retained the events of
 * every run it had ever served. These tests pin the two bounds that replace
 * that: a grace window after a run finishes, and a cap on finished runs kept.
 *
 * Time is faked so the grace window is a fact rather than a sleep.
 */

const at = (runId: string, type: RunEvent['type'], message?: string): RunEvent => ({
  type,
  runId,
  at: new Date().toISOString(),
  ...(message !== undefined ? { message } : {}),
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the run event buffer', () => {
  it('keeps the last 500 events of one run', () => {
    for (let i = 0; i < 510; i += 1) {
      recordEvent(at('run_long', 'audit.started', `lead ${i}`));
    }

    const kept = eventsFor('run_long');
    expect(kept).toHaveLength(500);
    // Oldest first, so the surviving window starts at the tenth event.
    expect(kept[0]?.message).toBe('lead 10');
    expect(kept.at(-1)?.message).toBe('lead 509');
  });

  it('drops a finished run once the grace window has passed', () => {
    recordEvent(at('run_done', 'run.finished', 'all done'));
    expect(eventsFor('run_done')).toHaveLength(1);

    // A later event is what triggers the sweep, so one has to happen.
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    recordEvent(at('run_other', 'run.started'));

    expect(eventsFor('run_done')).toHaveLength(0);
  });

  it('never drops a run that is still going, however long it takes', () => {
    recordEvent(at('run_slow', 'run.started'));
    recordEvent(at('run_slow', 'audit.started', 'first'));

    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    recordEvent(at('run_slow', 'audit.finished', 'last'));

    // An hour-long run is still the run the browser is watching.
    expect(eventsFor('run_slow')).toHaveLength(3);
  });

  it('keeps at most twenty finished runs, dropping the oldest', () => {
    const first = 'run_000';
    for (let i = 0; i < 21; i += 1) {
      recordEvent(at(`run_${String(i).padStart(3, '0')}`, 'run.finished'));
    }

    expect(eventsFor(first)).toHaveLength(0);
    expect(eventsFor('run_001')).toHaveLength(1);
    expect(eventsFor('run_020')).toHaveLength(1);
  });

  it('drops nothing while a run is unfinished, even past the cap', () => {
    for (let i = 0; i < 25; i += 1) {
      recordEvent(at(`run_live_${i}`, 'run.started'));
    }

    // Only one run can be active at a time in practice, but the buffer's rule is
    // that an unfinished run is never a candidate for eviction.
    expect(eventsFor('run_live_0')).toHaveLength(1);
  });
});

describe('subscribers', () => {
  it('delivers to a live subscriber and buffers at the same time', () => {
    const seen: RunEvent[] = [];
    const unsubscribe = subscribe('run_a', (event) => seen.push(event));

    publish(at('run_a', 'run.started', 'hello'));

    expect(seen).toHaveLength(1);
    expect(eventsFor('run_a')).toHaveLength(1);
    unsubscribe();
  });

  it('stops delivering once unsubscribed', () => {
    const seen: RunEvent[] = [];
    const unsubscribe = subscribe('run_b', (event) => seen.push(event));

    publish(at('run_b', 'run.started'));
    unsubscribe();
    publish(at('run_b', 'run.finished'));

    expect(seen).toHaveLength(1);
  });

  it('keeps going when one subscriber throws', () => {
    const seen: RunEvent[] = [];
    const unsubscribeBad = subscribe('run_c', () => {
      throw new Error('this client went away');
    });
    const unsubscribeGood = subscribe('run_c', (event) => seen.push(event));

    expect(() => publish(at('run_c', 'run.started'))).not.toThrow();
    expect(seen).toHaveLength(1);

    unsubscribeBad();
    unsubscribeGood();
  });

  it('knows which events end a run', () => {
    expect(isTerminalEvent(at('run_d', 'run.finished'))).toBe(true);
    expect(isTerminalEvent(at('run_d', 'run.failed'))).toBe(true);
    expect(isTerminalEvent(at('run_d', 'run.cancelled'))).toBe(true);
    expect(isTerminalEvent(at('run_d', 'audit.finished'))).toBe(false);
  });
});
