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
import { createApp } from './app.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerRunRoutes } from './routes/runs.js';
import { setWorkflowDeps } from './mastra/workflows/find-and-audit-leads.js';
import { pipelineDeps } from './runtime.js';
import type { AppRuntime } from './runtime.js';
import { createEventEmitter } from '@localscout/core';

/**
 * API integration tests.
 *
 * The app is exercised through `app.fetch`, which is the same entry point the
 * Node server uses. That keeps the tests fast and free of port binding while
 * still covering routing, validation, and response shapes end to end against a
 * real database.
 *
 * No network is used: discovery is not exercised here (the pipeline tests cover
 * it), and drafting runs against the fixture provider.
 */

describe('api', () => {
  let dir: string;
  let handle: Db;
  let runtime: AppRuntime;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'localscout-api-'));
    const url = join(dir, 'test.db');
    runMigrations({ url });
    handle = openDb({ url });

    const config = loadConfig({} as NodeJS.ProcessEnv);
    runtime = {
      config,
      db: handle,
      repos: createRepositories(handle),
      logger: createLogger({
        level: 'silent',
        destination: new Writable({ write: (_c, _e, cb) => cb() }),
      }),
      provider: new FixtureProvider(),
      sender: { name: 'Aditya', portfolioUrl: 'https://aditya.example/', services: 'websites' },
      databaseUrl: url,
      reportDir: join(dir, 'reports'),
      close: () => handle.close(),
    };

    app = createApp(runtime);
    registerHealthRoutes(app, runtime);
    registerRunRoutes(app, runtime);
    registerLeadRoutes(app, runtime);

    setWorkflowDeps(pipelineDeps(runtime, createEventEmitter('test')));
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string) => app.fetch(new Request(`http://127.0.0.1${path}`));
  const post = (path: string, body?: unknown) =>
    app.fetch(
      new Request(`http://127.0.0.1${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const patch = (path: string, body: unknown) =>
    app.fetch(
      new Request(`http://127.0.0.1${path}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  describe('security', () => {
    it('sets conservative security headers', async () => {
      const response = await get('/api/health');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    });

    it('allows the dev origin and refuses others', async () => {
      const allowed = await app.fetch(
        new Request('http://127.0.0.1/api/health', {
          headers: { origin: 'http://localhost:5173' },
        }),
      );
      expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

      const refused = await app.fetch(
        new Request('http://127.0.0.1/api/health', {
          headers: { origin: 'https://evil.example' },
        }),
      );
      expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects an oversized body', async () => {
      const response = await app.fetch(
        new Request('http://127.0.0.1/api/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': '500000' },
          body: JSON.stringify({ pad: 'x'.repeat(500_000) }),
        }),
      );
      expect(response.status).toBe(413);
    });

    it('returns a generic message for an unknown route', async () => {
      const response = await get('/api/nope');
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toContain('No route');
    });
  });

  describe('GET /api/health', () => {
    it('reports each check with a fix instruction when not satisfied', async () => {
      const body = (await (await get('/api/health')).json()) as {
        ok: boolean;
        checks: { name: string; ok: boolean; fix?: string }[];
        keys: { serpApi: boolean };
      };

      expect(body.checks.map((check) => check.name)).toEqual([
        'database',
        'chrome',
        'llm',
        'discovery',
      ]);
      // A failing check must say what to do about it.
      for (const check of body.checks) {
        if (!check.ok) expect(check.fix, check.name).toBeTruthy();
      }
    });

    it('never returns a key value', async () => {
      const body = (await (await get('/api/health')).json()) as {
        keys: {
          serpApi: boolean;
          llm: boolean;
        };
      };
      expect(JSON.stringify(body)).not.toContain('SERPAPI_API_KEY=');
      expect(body.keys).toEqual({ serpApi: false, llm: false });
    });

    it('reports the active modes', async () => {
      const body = (await (await get('/api/health')).json()) as { modes: Record<string, string> };
      expect(body.modes).toEqual({ discovery: 'fixtures', llm: 'fixture' });
    });
  });

  describe('POST /api/runs', () => {
    it('rejects a missing query or location with a readable message', async () => {
      const response = await post('/api/runs', { query: '', location: 'Bhopal' });
      expect(response.status).toBe(400);

      const body = (await response.json()) as { issues: { path: string; message: string }[] };
      expect(body.issues[0]?.message).toContain('business type');
    });

    it('rejects an out-of-range limit', async () => {
      const response = await post('/api/runs', {
        query: 'plumbers',
        location: 'Bhopal',
        limit: 99,
      });
      expect(response.status).toBe(400);
    });

    it('rejects an unknown language', async () => {
      const response = await post('/api/runs', {
        query: 'plumbers',
        location: 'Bhopal',
        language: 'fr',
      });
      expect(response.status).toBe(400);
    });

    it('rejects a malformed body', async () => {
      const response = await app.fetch(
        new Request('http://127.0.0.1/api/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not json',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('accepts a valid search and returns 202 with a run id', async () => {
      const response = await post('/api/runs', {
        query: 'plumbers',
        location: 'Bhopal',
        limit: 2,
      });
      expect(response.status).toBe(202);

      const body = (await response.json()) as { runId: string };
      expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('refuses a second concurrent run', async () => {
      const first = await post('/api/runs', { query: 'plumbers', location: 'Bhopal', limit: 2 });
      const { runId } = (await first.json()) as { runId: string };

      // Force the first run to still look active.
      runtime.db.sqlite.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(runId);

      const second = await post('/api/runs', { query: 'electricians', location: 'Bhopal' });
      expect(second.status).toBe(409);

      const body = (await second.json()) as { error: string; runId: string };
      expect(body.runId).toBe(runId);
      expect(body.error).toContain('already running');
    });
  });

  describe('runs listing', () => {
    it('lists and fetches runs', async () => {
      const created = await runtime.repos.runs.create({
        query: 'plumbers',
        location: 'Bhopal',
        limit: 5,
        language: 'en',
      });

      const list = (await (await get('/api/runs')).json()) as { runs: { id: string }[] };
      expect(list.runs.some((run) => run.id === created.id)).toBe(true);

      const one = await get(`/api/runs/${created.id}`);
      expect(one.status).toBe(200);

      const missing = await get('/api/runs/does-not-exist');
      expect(missing.status).toBe(404);
    });
  });

  describe('leads', () => {
    const seed = async (
      over: { name?: string; website?: string; domain?: string; mobile?: boolean } = {},
    ) =>
      runtime.repos.leads.insert({
        placeId: `p_${Math.random().toString(36).slice(2)}`,
        name: over.name ?? 'Test Plumbing',
        websiteUrl: over.website,
        domainKey: over.domain,
        phoneIsMobile: over.mobile === true ? true : undefined,
      });

    it('lists leads with a total', async () => {
      await seed({ name: 'Alpha Plumbing' });
      await seed({ name: 'Beta Electricals' });

      const body = (await (await get('/api/leads')).json()) as { leads: unknown[]; total: number };
      expect(body.total).toBe(2);
      expect(body.leads).toHaveLength(2);
    });

    it('filters by status', async () => {
      const lead = await seed();
      await runtime.repos.leads.setStatus(lead.id, 'sent');

      const body = (await (await get('/api/leads?status=sent')).json()) as {
        leads: { id: string }[];
      };
      expect(body.leads).toHaveLength(1);
      expect(body.leads[0]?.id).toBe(lead.id);
    });

    /*
     * The total used to be every lead in the database, so a filtered view of one
     * lead still reported two and the pager offered a second page of nothing.
     */
    it('reports a total that matches the filters', async () => {
      const sent = await seed({ name: 'Sent Co' });
      await seed({ name: 'Other Co' });
      await runtime.repos.leads.setStatus(sent.id, 'sent');

      const filtered = (await (await get('/api/leads?status=sent')).json()) as {
        leads: unknown[];
        total: number;
      };
      expect(filtered.total).toBe(1);
      expect(filtered.leads).toHaveLength(1);

      const searched = (await (await get('/api/leads?q=sent')).json()) as { total: number };
      expect(searched.total).toBe(1);

      const nothing = (await (await get('/api/leads?q=nobody')).json()) as { total: number };
      expect(nothing.total).toBe(0);

      const all = (await (await get('/api/leads')).json()) as { total: number };
      expect(all.total).toBe(2);
    });

    it('counts a minimum score the same way the list filters it', async () => {
      const hot = await seed({ name: 'Hot' });
      await seed({ name: 'Cold' });
      await runtime.repos.audits.create({
        leadId: hot.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 100,
        metrics: {},
        checks: [],
        findings: [],
        opportunityScore: 82,
      });

      const body = (await (await get('/api/leads?minScore=50')).json()) as {
        leads: { name: string }[];
        total: number;
      };
      expect(body.total).toBe(1);
      expect(body.leads.map((lead) => lead.name)).toEqual(['Hot']);
    });

    it('searches by name', async () => {
      await seed({ name: 'Sharma Plumbing' });
      await seed({ name: 'Gupta Interiors' });

      const body = (await (await get('/api/leads?q=sharma')).json()) as {
        leads: { name: string }[];
      };
      expect(body.leads).toHaveLength(1);
      expect(body.leads[0]?.name).toBe('Sharma Plumbing');
    });

    it('sorts by score then by name', async () => {
      await seed({ name: 'Zulu' });
      await seed({ name: 'Alpha' });

      const byName = (await (await get('/api/leads?sort=name')).json()) as {
        leads: { name: string }[];
      };
      expect(byName.leads.map((lead) => lead.name)).toEqual(['Alpha', 'Zulu']);
    });

    it('rejects an unknown status filter', async () => {
      const response = await get('/api/leads?status=bogus');
      expect(response.status).toBe(400);
    });

    it('returns a lead with its audit, drafts and log', async () => {
      const lead = await seed({ name: 'Detailed Co' });
      await runtime.repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 100,
        metrics: { lcp_ms: 6100 },
        checks: [],
        findings: [],
        opportunityScore: 42,
      });

      const body = (await (await get(`/api/leads/${lead.id}`)).json()) as {
        lead: { name: string };
        audit: { opportunityScore: number };
        drafts: Record<string, unknown>;
        contactLog: unknown[];
      };

      expect(body.lead.name).toBe('Detailed Co');
      expect(body.audit.opportunityScore).toBe(42);
      expect(body.drafts).toEqual({});
      expect(body.contactLog).toEqual([]);
    });

    it('404s for an unknown lead', async () => {
      expect((await get('/api/leads/nope')).status).toBe(404);
    });

    /*
     * The single-lead endpoint returned the raw row, so the modal showed a
     * blank score for a lead the grid had scored 42. The two shapes must not
     * drift apart.
     */
    it('returns the same derived fields as the list endpoint', async () => {
      const lead = await seed({ name: 'Contract Co', mobile: true });
      await runtime.repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 100,
        metrics: { lcp_ms: 6100 },
        checks: [],
        findings: [],
        opportunityScore: 42,
      });

      const detail = (await (await get(`/api/leads/${lead.id}`)).json()) as {
        lead: {
          opportunityScore: number | null;
          auditStatus: string | null;
          canWhatsApp: boolean;
          draftCount: number;
        };
      };
      const list = (await (await get('/api/leads?sort=score')).json()) as {
        leads: { id: string; opportunityScore: number | null }[];
      };
      const listed = list.leads.find((entry) => entry.id === lead.id);

      expect(detail.lead.opportunityScore).toBe(42);
      expect(detail.lead.opportunityScore).toBe(listed?.opportunityScore);
      expect(detail.lead.auditStatus).toBe('ok');
      expect(detail.lead.canWhatsApp).toBe(true);
      expect(detail.lead.draftCount).toBe(0);
    });

    it('reports nulls on the detail endpoint for an unaudited lead', async () => {
      const lead = await seed({ name: 'Unaudited Co' });
      const detail = (await (await get(`/api/leads/${lead.id}`)).json()) as {
        lead: { opportunityScore: number | null; auditStatus: string | null };
      };

      expect(detail.lead.opportunityScore).toBeNull();
      expect(detail.lead.auditStatus).toBeNull();
    });

    it('updates notes and status', async () => {
      const lead = await seed();
      const response = await patch(`/api/leads/${lead.id}`, {
        status: 'approved',
        notes: 'Called on Tuesday.',
      });

      const body = (await response.json()) as { lead: { status: string; notes: string } };
      expect(body.lead.status).toBe('approved');
      expect(body.lead.notes).toBe('Called on Tuesday.');
    });

    it('rejects an invalid status', async () => {
      const lead = await seed();
      expect((await patch(`/api/leads/${lead.id}`, { status: 'nonsense' })).status).toBe(400);
    });
  });

  describe('contact log', () => {
    it('records an event and advances the lead status', async () => {
      const lead = await runtime.repos.leads.insert({
        placeId: 'p_log',
        name: 'Logged Co',
        phoneIsMobile: true,
      });

      const response = await post(`/api/leads/${lead.id}/contact-log`, {
        channel: 'whatsapp',
        event: 'replied',
        note: 'They asked for a call.',
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        entry: { event: string };
        lead: { status: string };
      };
      expect(body.entry.event).toBe('replied');
      expect(body.lead.status).toBe('replied');
    });

    it('leaves the status alone for a note', async () => {
      const lead = await runtime.repos.leads.insert({ placeId: 'p_note', name: 'Note Co' });
      const response = await post(`/api/leads/${lead.id}/contact-log`, {
        channel: 'call',
        event: 'note',
        note: 'No answer.',
      });

      const body = (await response.json()) as { lead: { status: string } };
      expect(body.lead.status).toBe('discovered');
    });

    it('rejects an invalid event', async () => {
      const lead = await runtime.repos.leads.insert({ placeId: 'p_bad', name: 'Bad Co' });
      const response = await post(`/api/leads/${lead.id}/contact-log`, {
        channel: 'whatsapp',
        event: 'exploded',
      });
      expect(response.status).toBe(400);
    });

    it('404s for an unknown lead', async () => {
      const response = await post('/api/leads/nope/contact-log', {
        channel: 'email',
        event: 'sent',
      });
      expect(response.status).toBe(404);
    });
  });

  describe('drafts', () => {
    const audited = async () => {
      const lead = await runtime.repos.leads.insert({
        placeId: 'p_draft',
        name: 'Draft Co',
        websiteUrl: 'https://draftco.in',
      });
      await runtime.repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 100,
        metrics: { lcp_ms: 6100 },
        checks: [],
        findings: [
          {
            id: 'SLOW_LCP',
            severity: 'high',
            label: 'Slow to show main content',
            weight: 30,
            evidence: { lcp_ms: 6100, threshold_ms: 4000 },
          },
        ],
        opportunityScore: 30,
      });
      return lead;
    };

    it('refuses to draft an unaudited lead, and says why', async () => {
      const lead = await runtime.repos.leads.insert({ placeId: 'p_noaudit', name: 'No Audit Co' });
      const response = await post(`/api/leads/${lead.id}/drafts`, { language: 'en' });

      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toContain('not been audited');
    });

    it('generates a grounded draft', async () => {
      const lead = await audited();
      const response = await post(`/api/leads/${lead.id}/drafts`, { language: 'en' });

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        draft: { grounded: boolean; language: string; whatsappText: string };
        lead: { status: string };
      };
      expect(body.draft.grounded).toBe(true);
      expect(body.draft.language).toBe('en');
      expect(body.draft.whatsappText.length).toBeGreaterThan(0);
      expect(body.lead.status).toBe('drafted');
    });

    it('generates in each language', async () => {
      const lead = await audited();
      for (const language of ['en', 'hinglish', 'hi']) {
        const response = await post(`/api/leads/${lead.id}/drafts`, { language });
        const body = (await response.json()) as { draft: { language: string; grounded: boolean } };
        expect(body.draft.language).toBe(language);
        expect(body.draft.grounded).toBe(true);
      }
    });

    it('rejects an unknown language', async () => {
      const lead = await audited();
      const response = await post(`/api/leads/${lead.id}/drafts`, { language: 'fr' });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/metrics', () => {
    it('reports the aggregates the write-up quotes', async () => {
      const lead = await runtime.repos.leads.insert({ placeId: 'p_m', name: 'Metric Co' });
      await runtime.repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 1000,
        metrics: {},
        checks: [],
        findings: [],
        opportunityScore: 55,
      });
      await runtime.repos.drafts.create({
        leadId: lead.id,
        language: 'en',
        whatsappText: 'Hi',
        generatedBy: 'llm',
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 500,
        grounded: true,
        validationErrors: [],
      });

      const body = (await (await get('/api/metrics')).json()) as {
        leads: { total: number };
        audits: { total: number; averageDurationMs: number | null };
        drafts: { total: number; groundedPercent: number; tokensIn: number };
        cost: { llmCostPerLead: number; serpApiCallsPerLead: number | null };
        outreach: { milestones: { firstMessageSent: boolean } };
      };

      expect(body.leads.total).toBe(1);
      expect(body.audits.total).toBe(1);
      expect(body.audits.averageDurationMs).toBe(1000);
      expect(body.drafts.total).toBe(1);
      expect(body.drafts.groundedPercent).toBe(100);
      expect(body.drafts.tokensIn).toBe(100);
      // Local inference has no marginal cost; this is a stated fact, not an
      // estimate.
      expect(body.cost.llmCostPerLead).toBe(0);
      expect(body.outreach.milestones.firstMessageSent).toBe(false);
    });

    it('returns zeroed metrics on an empty database', async () => {
      const body = (await (await get('/api/metrics')).json()) as {
        leads: { total: number };
        drafts: { total: number };
        cost: { serpApiCallsPerLead: number | null };
      };
      expect(body.leads.total).toBe(0);
      expect(body.drafts.total).toBe(0);
      expect(body.cost.serpApiCallsPerLead).toBeNull();
    });
  });
});
