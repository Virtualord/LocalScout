import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  createRepositories,
  FixtureProvider,
  loadConfig,
  openDb,
  runMigrations,
  type Db,
} from '@localscout/core';
import { cancelRun, claimRun, reconcileInterruptedRuns } from './run-control.js';
import type { AppRuntime } from './runtime.js';

/**
 * Run ownership.
 *
 * Two rules are pinned here, and both were unenforced before: only one run may
 * be active, and a slot abandoned by a process that died is reclaimed. The first
 * was a check followed by a separate create, which two requests arriving
 * together could both pass; the second did not exist at all, so a crash refused
 * every later search until someone opened the database by hand.
 *
 * Runs started here are cancelled before the test ends, and Chrome is pointed at
 * a path that does not exist, so nothing in this file launches a browser or waits
 * on a real audit.
 */

describe('run control', () => {
  let dir: string;
  let handle: Db;
  let runtime: AppRuntime;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'localscout-run-control-'));
    const url = join(dir, 'test.db');
    runMigrations({ url });
    handle = openDb({ url });

    const config = loadConfig({
      CHROME_PATH: join(dir, 'no-such-chrome'),
      AUDIT_TIMEOUT_MS: '300',
      AUDIT_CONCURRENCY: '1',
    } as NodeJS.ProcessEnv);

    runtime = {
      config,
      db: handle,
      repos: createRepositories(handle),
      logger: createLogger({
        level: 'silent',
        destination: new Writable({ write: (_c, _e, cb) => cb() }),
      }),
      provider: new FixtureProvider(),
      sender: { name: 'Aditya', services: 'websites' },
      databaseUrl: url,
      reportDir: join(dir, 'reports'),
      webDist: undefined,
      close: () => handle.close(),
    };
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const request = {
    query: 'plumbers',
    location: 'Bhopal',
    limit: 1,
    language: 'en' as const,
  };

  describe('claimRun', () => {
    it('starts a run and reports its id', async () => {
      const claimed = await claimRun(runtime, request);
      expect(claimed.started).toBe(true);

      if (claimed.started) {
        const row = await runtime.repos.runs.requireById(claimed.runId);
        expect(row.query).toBe('plumbers');
        expect(['queued', 'running']).toContain(row.status);
        await cancelRun(runtime, claimed.runId);
      }
    });

    it('starts exactly one run when two claims arrive together', async () => {
      // The check and the create are separate statements, so without the queue
      // over them both of these see an empty slot and both start a run.
      const results = await Promise.all([
        claimRun(runtime, request),
        claimRun(runtime, { ...request, query: 'electricians' }),
      ]);

      expect(results.filter((result) => result.started)).toHaveLength(1);
      expect(await runtime.repos.runs.list(50)).toHaveLength(1);

      for (const result of results) {
        if (result.started) await cancelRun(runtime, result.runId);
      }
    });

    it('refuses a second run while one holds the slot, naming it', async () => {
      const active = await runtime.repos.runs.create(request);
      await runtime.repos.runs.setStatus(active.id, 'running');

      const claimed = await claimRun(runtime, { ...request, query: 'electricians' });

      expect(claimed.started).toBe(false);
      if (!claimed.started) expect(claimed.activeRunId).toBe(active.id);
      // The refusal did not leave a row behind.
      expect(await runtime.repos.runs.list(50)).toHaveLength(1);
    });
  });

  describe('cancelRun', () => {
    it('marks a running run cancelled and frees the slot', async () => {
      const running = await runtime.repos.runs.create(request);
      await runtime.repos.runs.setStatus(running.id, 'running');

      const result = await cancelRun(runtime, running.id);

      expect(result.cancelled).toBe(true);
      const stored = await runtime.repos.runs.requireById(running.id);
      expect(stored.status).toBe('cancelled');
      expect(stored.finishedAt).not.toBeNull();
      // Freed, which is what makes the endpoint a way out of the 409 rather
      // than a second dead end.
      expect(await runtime.repos.runs.activeRun()).toBeUndefined();
    });

    it('reports an unknown run rather than inventing one', async () => {
      const result = await cancelRun(runtime, 'nope');
      expect(result).toEqual({ cancelled: false, reason: 'not_found' });
    });

    it('refuses to rewrite a run that already ended', async () => {
      const done = await runtime.repos.runs.create(request);
      await runtime.repos.runs.setStatus(done.id, 'completed');

      const result = await cancelRun(runtime, done.id);

      expect(result).toEqual({ cancelled: false, reason: 'already_ended', status: 'completed' });
      expect((await runtime.repos.runs.requireById(done.id)).status).toBe('completed');
    });

    it('is idempotent, so a double click is not an error', async () => {
      const running = await runtime.repos.runs.create(request);
      await runtime.repos.runs.setStatus(running.id, 'running');

      expect((await cancelRun(runtime, running.id)).cancelled).toBe(true);
      expect(await cancelRun(runtime, running.id)).toEqual({
        cancelled: false,
        reason: 'already_ended',
        status: 'cancelled',
      });
    });

    it('cannot be overwritten by the pipeline it interrupted', async () => {
      const running = await runtime.repos.runs.create(request);
      await runtime.repos.runs.setStatus(running.id, 'running');
      await cancelRun(runtime, running.id);

      // What a pipeline still in flight would try to write on its way out.
      await runtime.repos.runs.setStatus(running.id, 'completed');
      await runtime.repos.runs.setStatus(running.id, 'failed', 'the process died');

      const stored = await runtime.repos.runs.requireById(running.id);
      expect(stored.status).toBe('cancelled');
      expect(stored.error).toBeNull();
    });
  });

  describe('reconcileInterruptedRuns', () => {
    it('reaps a run stranded by a process that stopped', async () => {
      const stranded = await runtime.repos.runs.create(request);
      await runtime.repos.runs.setStatus(stranded.id, 'running');

      const reaped = await reconcileInterruptedRuns(runtime);

      expect(reaped).toBe(1);
      const stored = await runtime.repos.runs.requireById(stranded.id);
      expect(stored.status).toBe('failed');
      expect(stored.error).toContain('stopped before it finished');
      // Without this the next search would be refused for good.
      expect(await runtime.repos.runs.activeRun()).toBeUndefined();
    });

    it('leaves a finished run alone', async () => {
      const done = await runtime.repos.runs.create(request);
      await runtime.repos.runs.setStatus(done.id, 'completed');
      const cancelled = await runtime.repos.runs.create({ ...request, query: 'painters' });
      await runtime.repos.runs.setStatus(cancelled.id, 'cancelled');

      expect(await reconcileInterruptedRuns(runtime)).toBe(0);
      expect((await runtime.repos.runs.requireById(done.id)).status).toBe('completed');
      expect((await runtime.repos.runs.requireById(cancelled.id)).status).toBe('cancelled');
    });

    it('reports nothing to do on a clean database', async () => {
      expect(await reconcileInterruptedRuns(runtime)).toBe(0);
    });
  });
});
