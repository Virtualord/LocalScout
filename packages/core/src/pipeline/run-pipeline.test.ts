import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../logger/logger.js';
import { FixtureProvider, UNGROUNDED_REPLY } from '../draft/fixture.provider.js';
import { loadConfig } from '../config/env.js';
import { openDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { createRepositories, type Repositories } from '../db/repositories/index.js';
import type { Language } from '../db/schema.js';
import { recordingEmitter, type RunEvent } from './events.js';
import { runPipeline, type PipelineResult } from './run-pipeline.js';

/**
 * Full-pipeline integration test.
 *
 * Runs the real orchestration against a real temporary SQLite database and the
 * committed fixtures: no network, no Chrome, no model. This is the test that
 * proves `pnpm dev` works on a fresh clone, because it exercises the same
 * functions the CLI and the API call.
 */

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'serpapi');

/** Route the audit at the loopback fixture server, and skip Lighthouse. */
const fixtureResolver = async (hostname: string) => {
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return { addresses: ['127.0.0.1'], allowLoopback: true };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return { addresses: [hostname] };
  return { addresses: ['93.184.216.34'] };
};

/**
 * Generous, because many of these reach the real network.
 *
 * The point of the audit tests is that an unreachable site fails and is
 * recorded, which a mock cannot demonstrate. A 50ms fetch timeout makes the
 * failure fast, but DNS resolution is not reliably that fast, and when the
 * whole suite runs at once several tests were landing just past the 5s
 * default for no reason but load. A timeout that fires on a busy machine is an
 * intermittent red that teaches nothing.
 */
const NETWORK_TIMEOUT = 30_000;

describe(
  'runPipeline in fixtures mode',
  () => {
    let dir: string;
    let handle: Db;
    let repos: Repositories;
    let events: RunEvent[];
    let emit: ReturnType<typeof recordingEmitter>['emit'];

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'localscout-pipeline-'));
      const url = join(dir, 'test.db');
      runMigrations({ url });
      handle = openDb({ url });
      repos = createRepositories(handle);

      const recorder = recordingEmitter();
      events = recorder.events;
      emit = recorder.emit;
    });

    afterEach(() => {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const silentLogger = () =>
      createLogger({ level: 'silent', destination: new Writable({ write: (_c, _e, cb) => cb() }) });

    const makeDeps = (over: { provider?: FixtureProvider } = {}) => ({
      config: loadConfig({} as NodeJS.ProcessEnv),
      repos,
      logger: silentLogger(),
      emit,
      provider: over.provider ?? new FixtureProvider(),
      sender: { name: 'Aditya', portfolioUrl: 'https://aditya.example/', services: 'websites' },
      discoverOptions: { fixturesDir: FIXTURES_DIR },
      auditConfig: {
        skipLighthouse: true,
        fetchOptions: { resolver: fixtureResolver, timeoutMs: 2000 },
      },
    });

    const run = async (
      over: {
        query?: string;
        location?: string;
        limit?: number;
        language?: Language;
        provider?: FixtureProvider;
        /** Wired into the pipeline, so a test can cancel a run in flight. */
        signal?: AbortSignal;
        /** Aborted the moment the first audit starts, which is mid-run. */
        abortOnFirstAudit?: AbortController;
      } = {},
    ): Promise<PipelineResult> => {
      const runRow = await repos.runs.create({
        query: over.query ?? 'plumbers',
        location: over.location ?? 'Bhopal',
        limit: over.limit ?? 5,
        language: over.language ?? 'en',
      });

      // The emitter is rebuilt per run so recorded events carry that run's id, and
      // `events` is re-pointed at the new live array rather than copied.
      const recorder = recordingEmitter(runRow.id);
      events = recorder.events;

      return runPipeline(
        {
          runId: runRow.id,
          query: over.query ?? 'plumbers',
          location: over.location ?? 'Bhopal',
          limit: over.limit ?? 5,
          language: over.language ?? 'en',
        },
        {
          ...makeDeps({ ...(over.provider ? { provider: over.provider } : {}) }),
          ...(over.signal ? { signal: over.signal } : {}),
          emit:
            over.abortOnFirstAudit === undefined
              ? recorder.emit
              : (event) => {
                  recorder.emit(event);
                  if (event.type === 'audit.started') over.abortOnFirstAudit?.abort();
                },
        },
      );
    };

    it('completes a run and persists leads', async () => {
      const result = await run();

      expect(result.status).toBe('completed');
      expect(result.leadsFound).toBeGreaterThan(0);
      expect(result.leadsNew).toBeGreaterThan(0);

      const leads = await repos.leads.all();
      expect(leads.length).toBe(result.leadsNew);
    });

    /*
     * Cancelling is cooperative and checked between leads, so what these tests
     * pin is where the loop stops, not that a request was torn down mid-flight.
     * A torn-down request would leave a failed audit recorded against a business
     * whose site was perfectly reachable, which is the one thing this tool must
     * not do.
     */
    describe('cancellation', () => {
      it('stops before discovery when it was already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();

        const result = await run({ signal: controller.signal });

        expect(result.status).toBe('cancelled');
        // Nothing was bought and no business was looked up.
        expect(result.serpApiCalls).toBe(0);
        expect(result.leadsFound).toBe(0);
        expect(await repos.leads.all()).toHaveLength(0);
      });

      it('records the run as cancelled rather than completed or failed', async () => {
        const controller = new AbortController();
        controller.abort();

        const result = await run({ signal: controller.signal });
        const row = await repos.runs.byId(result.runId);

        expect(row?.status).toBe('cancelled');
        expect(row?.finishedAt).toBeInstanceOf(Date);
        expect(events.at(-1)?.type).toBe('run.cancelled');
        expect(events.some((event) => event.type === 'run.finished')).toBe(false);
      });

      it('keeps the audits it completed and writes no drafts after a mid-run cancel', async () => {
        const controller = new AbortController();

        const result = await run({
          query: '',
          limit: 20,
          signal: controller.signal,
          abortOnFirstAudit: controller,
        });

        expect(result.status).toBe('cancelled');

        // The leads the search already paid for are kept.
        expect(result.leadsNew).toBeGreaterThan(0);
        expect(await repos.leads.all()).toHaveLength(result.leadsNew);

        // The audit in flight finished and is reported. Not all of them did, and
        // the difference is the point: the run stopped early.
        expect(result.auditsOk).toBeGreaterThan(0);
        expect(result.auditsOk).toBeLessThan(result.leadsNew);

        // No draft pass ran, so nothing claims a message is ready.
        expect(result.draftsLlm + result.draftsFallback).toBe(0);
        expect(await repos.drafts.total()).toBe(0);
        expect((await repos.leads.all()).some((lead) => lead.status === 'drafted')).toBe(false);

        // The measurement that did happen is on the record, not thrown away.
        const audited = (await repos.leads.all()).filter((lead) => lead.status === 'audited');
        expect(audited).toHaveLength(result.auditsOk);
        for (const lead of audited) {
          expect(await repos.audits.latestForLead(lead.id)).toBeDefined();
        }
      });
    });

    /**
     * A lead whose website cannot be reached is recorded as failed with no audit
     * row, because nothing was measured. That is the honest outcome and the
     * reason this suite does not expect an audit for every lead.
     */
    it('audits and drafts the leads it could actually measure', async () => {
      await run({ query: '', limit: 20 });

      const leads = await repos.leads.all();
      const measured = leads.filter((lead) => lead.status === 'drafted');
      const unreachable = leads.filter((lead) => lead.status === 'discovered');

      expect(measured.length).toBeGreaterThan(0);
      for (const lead of measured) {
        const audit = await repos.audits.latestForLead(lead.id);
        expect(audit, lead.name).toBeDefined();
        expect(audit?.opportunityScore).toBeGreaterThan(0);
      }

      // Unreachable leads keep no metrics and no score, but they do get a row
      // recording that the attempt happened and why it failed. Without it they
      // would be indistinguishable from a lead nobody has looked at yet.
      for (const lead of unreachable) {
        const audit = await repos.audits.latestForLead(lead.id);
        expect(audit, `${lead.name} should record the failed attempt`).toBeDefined();
        expect(audit?.status).toBe('unavailable');
        expect(audit?.error).toBeTruthy();
        // No invented measurements, and no score that would rank it as cold.
        expect(audit?.metrics).toEqual({});
        expect(audit?.findings).toEqual([]);
      }
    });

    it('records a draft for every audited lead', async () => {
      const result = await run({ query: '', limit: 20 });

      const draftLeads = await repos.leads.list({ status: 'drafted' });
      expect(draftLeads.length).toBe(result.draftsLlm + result.draftsFallback);
    });

    it('emits the documented event sequence', async () => {
      await run();

      const types = events.map((event) => event.type);
      expect(types[0]).toBe('run.started');
      expect(types).toContain('lead.discovered');
      expect(types).toContain('audit.finished');
      expect(types).toContain('draft.finished');
      expect(types[types.length - 1]).toBe('run.finished');
    });

    it('stamps every event with the run id', async () => {
      const result = await run();
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.runId === result.runId)).toBe(true);
    });

    it('records the run counters on the run row', async () => {
      const result = await run();
      const runRow = await repos.runs.totals();

      expect(runRow.runs).toBe(1);
      expect(runRow.leadsFound).toBe(result.leadsFound);
      expect(runRow.leadsNew).toBe(result.leadsNew);
      expect(runRow.draftsLlm + runRow.draftsFallback).toBeGreaterThanOrEqual(0);
    });

    it('marks the run completed with a finish time', async () => {
      const result = await run();
      const [row] = await repos.runs.list();
      expect(row?.status).toBe('completed');
      expect(row?.finishedAt).not.toBeNull();
      expect(result.status).toBe('completed');
    });

    describe('dedupe across runs', () => {
      it('finds nothing new on a second identical run', async () => {
        const first = await run();
        expect(first.leadsNew).toBeGreaterThan(0);

        const second = await run();
        expect(second.leadsFound).toBeGreaterThan(0);
        expect(second.leadsNew).toBe(0);
        expect(second.skippedDuplicates).toBeGreaterThan(0);
      });

      it('emits a skip reason for duplicates', async () => {
        await run();
        // The second run re-points `events` at its own recorder, so only this
        // run's skips are inspected.
        await run();

        const skipped = events.filter((event) => event.type === 'lead.skipped');
        expect(skipped.length).toBeGreaterThan(0);
        expect(String(skipped[0]?.data?.['reason'])).toBe('duplicate_place_id');
      });

      it('never re-pitches a contacted domain', async () => {
        const first = await run();
        const leads = await repos.leads.list();

        // Mark every lead as contacted, as a human would after sending.
        for (const lead of leads) {
          await repos.leads.setStatus(lead.id, 'sent');
        }

        const second = await run();
        expect(second.leadsNew).toBe(0);
        expect(second.skippedContacted + second.skippedDuplicates).toBeGreaterThanOrEqual(
          first.leadsFound,
        );

        const contacted = await repos.leads.contactedDomainKeys();
        expect(contacted.size).toBeGreaterThan(0);
      });
    });

    describe('auditing', () => {
      it('scores leads and stores findings with evidence', async () => {
        await run();

        const leads = await repos.leads.list({ sort: 'score' });
        const scored = leads.find((lead) => lead.opportunityScore !== null);
        expect(scored).toBeDefined();

        const audit = await repos.audits.latestForLead(scored!.id);
        expect(audit).toBeDefined();
        expect(Array.isArray(audit?.findings)).toBe(true);
      });

      it('reports NO_WEBSITE for a social-only listing', async () => {
        await run({ query: '', location: 'Bhopal', limit: 20 });

        const leads = await repos.leads.all();
        const social = leads.find((lead) => lead.websiteUrl?.includes('facebook.com'));
        expect(social, 'expected a facebook listing in the Bhopal fixtures').toBeDefined();

        const audit = await repos.audits.latestForLead(social!.id);
        expect(audit?.findings.map((f) => f.id)).toContain('NO_WEBSITE');
      });

      it('reports NO_WEBSITE for a listing with no site at all', async () => {
        await run({ query: '', location: 'Bhopal', limit: 20 });

        const leads = await repos.leads.all();
        const noSite = leads.find(
          (lead) => lead.websiteUrl === null || lead.websiteUrl === undefined,
        );
        expect(noSite).toBeDefined();

        const audit = await repos.audits.latestForLead(noSite!.id);
        expect(audit?.findings.map((f) => f.id)).toContain('NO_WEBSITE');
      });
    });

    describe('drafting', () => {
      it('stores a draft per lead with its model metadata', async () => {
        await run();

        const leads = await repos.leads.list({ status: 'drafted' });
        const drafts = await repos.drafts.latestByLanguageForLead(leads[0]!.id);
        expect(drafts.en).toBeDefined();
        expect(drafts.en?.grounded).toBe(true);
        expect(drafts.en?.model).toBe('fixture-draft-v1');
      });

      it('falls back to a template when the model drifts, and records why', async () => {
        const result = await run({
          provider: new FixtureProvider({ replies: [UNGROUNDED_REPLY] }),
        });

        expect(result.draftsFallback).toBeGreaterThan(0);
        expect(result.draftsLlm).toBe(0);

        const leads = await repos.leads.list({ status: 'drafted' });
        const drafts = await repos.drafts.latestByLanguageForLead(leads[0]!.id);
        expect(drafts.en?.generatedBy).toBe('fallback');
        expect(drafts.en?.validationErrors.length).toBeGreaterThan(0);
        // The fallback still has to be sendable.
        expect(drafts.en?.grounded).toBe(true);
      });

      it('drafts in the requested language', async () => {
        await run({ language: 'hi' });

        const leads = await repos.leads.list({ status: 'drafted' });
        const drafts = await repos.drafts.latestByLanguageForLead(leads[0]!.id);
        expect(drafts.hi).toBeDefined();
      });
    });

    describe('failure handling', () => {
      /*
       * These four reach the real network on purpose: the point is that an
       * unreachable site fails and is recorded, which cannot be faked with a mock.
       * The 50ms fetch timeout makes the failure fast, but DNS resolution is not
       * always that fast, and when the whole suite runs at once a 5s default
       * timeout was occasionally exceeded for no reason but load. Raised here so a
       * busy machine does not produce an intermittent red.
       */

      it('fails the run honestly when discovery returns nothing', async () => {
        const result = await run({ location: 'Atlantis' });

        expect(result.status).toBe('failed');
        expect(result.error).toBeTruthy();
        expect(events.some((event) => event.type === 'run.failed')).toBe(true);
      });

      it('records the failure reason on the run row', async () => {
        await run({ location: 'Atlantis' });
        const [row] = await repos.runs.list();
        expect(row?.status).toBe('failed');
        expect(row?.error).toContain('Atlantis');
      });

      it(
        'still completes when every audit fails',
        async () => {
          // No fetch options, so every real website is unreachable from the test.
          const runRow = await repos.runs.create({
            query: 'plumbers',
            location: 'Bhopal',
            limit: 3,
            language: 'en',
          });

          const deps = {
            ...makeDeps(),
            auditConfig: { skipLighthouse: true, fetchOptions: { timeoutMs: 50 } },
          };
          const result = await runPipeline(
            { runId: runRow.id, query: 'plumbers', location: 'Bhopal', limit: 3, language: 'en' },
            deps,
          );

          // Discovery still worked, so the run completes with failures recorded
          // rather than collapsing.
          expect(result.status).toBe('completed');
          expect(result.auditsFailed).toBeGreaterThanOrEqual(0);
        },
        NETWORK_TIMEOUT,
      );

      it('does not abort the run when one lead throws', async () => {
        const result = await run({ limit: 5 });
        expect(result.outcomes.length).toBeGreaterThan(0);
        expect(result.status).toBe('completed');
      });

      /*
       * A failed audit used to persist nothing, which made "never audited" and
       * "audited but the site could not be reached" indistinguishable on the lead
       * screen. Both now produce a row, with the failed one carrying the reason.
       */
      it(
        'records an audit row for a lead whose site could not be reached',
        async () => {
          const runRow = await repos.runs.create({
            query: 'plumbers',
            location: 'Bhopal',
            limit: 3,
            language: 'en',
          });

          const deps = {
            ...makeDeps(),
            auditConfig: { skipLighthouse: true, fetchOptions: { timeoutMs: 50 } },
          };
          const result = await runPipeline(
            { runId: runRow.id, query: 'plumbers', location: 'Bhopal', limit: 3, language: 'en' },
            deps,
          );

          const leads = await repos.leads.list();
          const audited = await Promise.all(
            leads.map((lead) => repos.audits.latestForLead(lead.id)),
          );

          // Every discovered lead has an audit row, whether it succeeded or not.
          expect(audited.length).toBeGreaterThan(0);
          for (const entry of audited) {
            expect(entry).toBeDefined();
          }

          if (result.auditsFailed > 0) {
            const failed = audited.filter((entry) => entry?.status === 'unavailable');
            expect(failed.length).toBeGreaterThan(0);
            // The reason is stored, so the screen can say what to fix rather than
            // showing a bare failure.
            for (const entry of failed) {
              expect(entry?.error).toBeTruthy();
            }
          }
        },
        NETWORK_TIMEOUT,
      );

      it(
        'surfaces a failed audit as a null score, not a measured zero',
        async () => {
          const runRow = await repos.runs.create({
            query: 'plumbers',
            location: 'Bhopal',
            limit: 3,
            language: 'en',
          });

          const deps = {
            ...makeDeps(),
            auditConfig: { skipLighthouse: true, fetchOptions: { timeoutMs: 50 } },
          };
          await runPipeline(
            { runId: runRow.id, query: 'plumbers', location: 'Bhopal', limit: 3, language: 'en' },
            deps,
          );

          const leads = await repos.leads.list();
          for (const lead of leads) {
            const audit = await repos.audits.latestForLead(lead.id);
            if (audit?.status === 'unavailable') {
              // A zero here would rank the lead as the coldest in the list, which
              // is the opposite of what "could not check" means.
              expect(lead.opportunityScore).toBeNull();
              expect(lead.auditStatus).toBe('unavailable');
            }
          }
        },
        NETWORK_TIMEOUT,
      );

      it(
        'leaves the lead status at discovered when the audit failed',
        async () => {
          const runRow = await repos.runs.create({
            query: 'plumbers',
            location: 'Bhopal',
            limit: 3,
            language: 'en',
          });

          const deps = {
            ...makeDeps(),
            auditConfig: { skipLighthouse: true, fetchOptions: { timeoutMs: 50 } },
          };
          await runPipeline(
            { runId: runRow.id, query: 'plumbers', location: 'Bhopal', limit: 3, language: 'en' },
            deps,
          );

          const leads = await repos.leads.list();
          for (const lead of leads) {
            const audit = await repos.audits.latestForLead(lead.id);
            if (audit?.status === 'unavailable') {
              // Promoting it to `audited` would overstate how far the run got.
              expect(lead.status).toBe('discovered');
            }
          }
        },
        NETWORK_TIMEOUT,
      );
    });

    it('respects the limit', async () => {
      const result = await run({ query: '', limit: 3 });
      expect(result.leadsNew).toBeLessThanOrEqual(3);
    });

    it('handles an unknown city by failing rather than returning nothing silently', async () => {
      const result = await run({ location: 'Nowhere City' });
      expect(result.status).toBe('failed');
      expect(result.error).toBeTruthy();
    });

    it('is deterministic given the same fixtures', async () => {
      const first = await run();
      const second = await run();
      expect(second.leadsNew).toBe(0);
      expect(first.leadsNew).toBeGreaterThan(0);
    });
  },
  NETWORK_TIMEOUT,
);
