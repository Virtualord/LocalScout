import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../client.js';
import { runMigrations } from '../migrate.js';
import { createRepositories, type CreateLeadInput, type Repositories } from './index.js';

describe('repositories', () => {
  let dir: string;
  let handle: Db;
  let repos: Repositories;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'localscout-repos-'));
    const url = join(dir, 'test.db');
    runMigrations({ url });
    handle = openDb({ url });
    repos = createRepositories(handle);
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const seedLead = async (overrides: Partial<CreateLeadInput> = {}) => {
    return repos.leads.insert({
      placeId: `place_${Math.random().toString(36).slice(2)}`,
      name: 'Sharma Plumbing',
      phoneIsMobile: true,
      rating: 4.5,
      reviewCount: 120,
      ...overrides,
    });
  };

  const seedAudit = async (leadId: string, score: number, status: 'ok' | 'stale' = 'ok') =>
    repos.audits.create({
      leadId,
      status,
      startedAt: new Date(),
      durationMs: 1500,
      metrics: { lcp_ms: 6100, cls: 0.31, tbt_ms: 420, perf_score: 38 },
      checks: [],
      findings: [],
      opportunityScore: score,
    });

  describe('lead repository', () => {
    it('stores and reads a lead', async () => {
      const lead = await seedLead({ name: 'Verma Electric', category: 'Electrician' });
      const found = await repos.leads.requireById(lead.id);

      expect(found.name).toBe('Verma Electric');
      expect(found.category).toBe('Electrician');
      expect(found.status).toBe('discovered');
    });

    it('refuses a duplicate place_id', async () => {
      await seedLead({ placeId: 'place_dup' });
      await expect(seedLead({ placeId: 'place_dup', name: 'Copy' })).rejects.toThrow();
    });

    it('reports known place ids in one query', async () => {
      await seedLead({ placeId: 'a' });
      await seedLead({ placeId: 'b' });

      const known = await repos.leads.knownPlaceIds(['a', 'b', 'c']);
      expect(known).toEqual(new Set(['a', 'b']));
    });

    it('returns an empty set without querying when given nothing', async () => {
      expect(await repos.leads.knownPlaceIds([])).toEqual(new Set());
    });

    describe('never pitch twice', () => {
      it('treats a contacted domain as off limits', async () => {
        const first = await seedLead({ placeId: 'p1', domainKey: 'example.com' });
        await repos.leads.setStatus(first.id, 'sent');

        const contacted = await repos.leads.contactedDomainKeys();
        expect(contacted.has('example.com')).toBe(true);
      });

      it('treats every contacted status as off limits', async () => {
        for (const status of ['approved', 'sent', 'replied', 'won', 'lost'] as const) {
          const lead = await seedLead({ placeId: `p_${status}`, domainKey: `${status}.com` });
          await repos.leads.setStatus(lead.id, status);
        }

        const contacted = await repos.leads.contactedDomainKeys();
        for (const status of ['approved', 'sent', 'replied', 'won', 'lost']) {
          expect(contacted.has(`${status}.com`), `${status} should be contacted`).toBe(true);
        }
      });

      it('does not block a discovered or skipped domain', async () => {
        for (const status of ['discovered', 'audited', 'drafted', 'skipped'] as const) {
          const lead = await seedLead({ placeId: `n_${status}`, domainKey: `${status}.com` });
          await repos.leads.setStatus(lead.id, status);
        }

        const contacted = await repos.leads.contactedDomainKeys();
        expect(contacted.size).toBe(0);
      });

      it('ignores leads with no domain', async () => {
        const lead = await seedLead({ placeId: 'p_no_domain' });
        await repos.leads.setStatus(lead.id, 'sent');

        expect(await repos.leads.contactedDomainKeys()).toEqual(new Set());
      });
    });

    describe('listing with the latest audit score', () => {
      it('sorts by the newest audit, not the oldest', async () => {
        const lead = await seedLead({ name: 'Multi Audit Co' });
        await seedAudit(lead.id, 20);
        await seedAudit(lead.id, 91);

        const [listed] = await repos.leads.list({ sort: 'score' });
        expect(listed?.opportunityScore).toBe(91);
      });

      it('reports null score for an unaudited lead', async () => {
        await seedLead({ name: 'Never Audited' });
        const [listed] = await repos.leads.list();
        expect(listed?.opportunityScore).toBeNull();
        expect(listed?.auditStatus).toBeNull();
      });

      it('filters by minimum score', async () => {
        const hot = await seedLead({ name: 'Hot' });
        const cold = await seedLead({ name: 'Cold' });
        await seedAudit(hot.id, 88);
        await seedAudit(cold.id, 12);

        const results = await repos.leads.list({ minScore: 50 });
        expect(results).toHaveLength(1);
        expect(results[0]?.name).toBe('Hot');
      });

      it('excludes unaudited leads from a minimum score filter', async () => {
        await seedLead({ name: 'Unaudited' });
        expect(await repos.leads.list({ minScore: 1 })).toHaveLength(0);
      });

      it('searches name, address and category', async () => {
        await seedLead({ name: 'Sharma Plumbing' });
        await repos.leads.insert({
          placeId: 'p2',
          name: 'Gupta Cafe',
          category: 'Cafe',
          address: 'MP Nagar',
        });

        expect(await repos.leads.list({ q: 'sharma' })).toHaveLength(1);
        expect(await repos.leads.list({ q: 'MP Nagar' })).toHaveLength(1);
        expect(await repos.leads.list({ q: 'Cafe' })).toHaveLength(1);
        expect(await repos.leads.list({ q: 'nothing here' })).toHaveLength(0);
      });

      it('filters by status', async () => {
        const lead = await seedLead();
        await repos.leads.setStatus(lead.id, 'sent');
        expect(await repos.leads.list({ status: 'sent' })).toHaveLength(1);
        expect(await repos.leads.list({ status: 'lost' })).toHaveLength(0);
      });

      it('sorts by name and newest', async () => {
        await seedLead({ name: 'Alpha' });
        await seedLead({ name: 'Zulu' });
        const byName = await repos.leads.list({ sort: 'name' });
        expect(byName.map((l) => l.name)).toEqual(['Alpha', 'Zulu']);

        const byNewest = await repos.leads.list({ sort: 'newest' });
        expect(byNewest[0]?.name).toBe('Zulu');
      });

      it('reports whether WhatsApp is available from the mobile flag', async () => {
        await seedLead({ name: 'Mobile Shop', phoneIsMobile: true });
        await seedLead({ name: 'Landline Shop', phoneIsMobile: false });
        await seedLead({ name: 'No Phone', phoneIsMobile: undefined });

        const rows = await repos.leads.list({ sort: 'name' });
        const canWhatsApp = new Map(rows.map((r) => [r.name, r.canWhatsApp]));
        expect(canWhatsApp.get('Mobile Shop')).toBe(true);
        expect(canWhatsApp.get('Landline Shop')).toBe(false);
        expect(canWhatsApp.get('No Phone')).toBe(false);
      });

      it('counts drafts per lead', async () => {
        const lead = await seedLead({ name: 'Drafty' });
        await repos.drafts.create({
          leadId: lead.id,
          language: 'en',
          whatsappText: 'Hi',
          generatedBy: 'llm',
          tokensIn: 10,
          tokensOut: 20,
          latencyMs: 100,
          grounded: true,
          validationErrors: [],
        });

        const [listed] = await repos.leads.list();
        expect(listed?.draftCount).toBe(1);
      });
    });

    it('counts leads by status, defaulting every bucket to zero', async () => {
      const lead = await seedLead();
      await repos.leads.setStatus(lead.id, 'sent');

      const counts = await repos.leads.countByStatus();
      expect(counts.sent).toBe(1);
      expect(counts.discovered).toBe(0);
      expect(counts.won).toBe(0);
    });

    it('records a skip reason only when skipping', async () => {
      const lead = await seedLead();
      const skipped = await repos.leads.setStatus(lead.id, 'skipped', 'not a real business');
      expect(skipped.skipReason).toBe('not a real business');

      const revived = await repos.leads.setStatus(lead.id, 'audited');
      expect(revived.skipReason).toBe('not a real business');
    });

    it('updates notes and a contact email', async () => {
      const lead = await seedLead();
      await repos.leads.setNotes(lead.id, 'Called on Tuesday.');
      expect((await repos.leads.requireById(lead.id)).notes).toBe('Called on Tuesday.');

      await repos.leads.setContactEmail(lead.id, 'hello@example.com');
      expect((await repos.leads.requireById(lead.id)).contactEmail).toBe('hello@example.com');
    });
  });

  describe('audit repository', () => {
    it('stores metrics, checks and findings as JSON', async () => {
      const lead = await seedLead();
      const audit = await repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 2200,
        metrics: { lcp_ms: 6100, cls: 0.31, perf_score: 38 },
        checks: [{ id: 'has_viewport', passed: false, value: false }],
        findings: [
          {
            id: 'SLOW_LCP',
            severity: 'high',
            label: 'Slow',
            evidence: { lcp_ms: 6100 },
            weight: 30,
          },
        ],
        opportunityScore: 70,
      });

      expect(audit.metrics.lcp_ms).toBe(6100);
      expect(audit.checks[0]?.id).toBe('has_viewport');
      expect(audit.findings[0]?.id).toBe('SLOW_LCP');
    });

    it('stores an unavailable audit with its error', async () => {
      const lead = await seedLead();
      const audit = await repos.audits.create({
        leadId: lead.id,
        status: 'unavailable',
        error: 'DNS lookup failed for shop.example.com',
        startedAt: new Date(),
        durationMs: 300,
        metrics: {},
        checks: [],
        findings: [],
        opportunityScore: 60,
      });

      expect(audit.status).toBe('unavailable');
      expect(audit.error).toContain('DNS');
    });

    it('returns the latest audit for a lead', async () => {
      const lead = await seedLead();
      const older = await repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(Date.now() - 60_000),
        durationMs: 100,
        metrics: {},
        checks: [],
        findings: [],
        opportunityScore: 10,
      });
      const newer = await repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 100,
        metrics: {},
        checks: [],
        findings: [],
        opportunityScore: 90,
      });

      const latest = await repos.audits.latestForLead(lead.id);
      expect(latest?.opportunityScore).toBe(90);
      expect(latest?.id).toBe(newer.id);
      expect(older.id).not.toBe(newer.id);
    });

    it('averages audit duration for the metrics endpoint', async () => {
      const lead = await seedLead();
      await repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 1000,
        metrics: {},
        checks: [],
        findings: [],
        opportunityScore: 50,
      });
      await repos.audits.create({
        leadId: lead.id,
        status: 'ok',
        startedAt: new Date(),
        durationMs: 3000,
        metrics: {},
        checks: [],
        findings: [],
        opportunityScore: 50,
      });

      expect(await repos.audits.averageDurationMs()).toBe(2000);
    });

    it('returns null for average duration with no audits', async () => {
      expect(await repos.audits.averageDurationMs()).toBeNull();
    });
  });

  describe('draft repository', () => {
    const seedDraft = async (leadId: string, language: 'en' | 'hi' | 'hinglish', grounded = true) =>
      repos.drafts.create({
        leadId,
        language,
        whatsappText: `Draft in ${language}`,
        generatedBy: grounded ? 'llm' : 'fallback',
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 800,
        grounded,
        validationErrors: grounded ? [] : ['invented_number'],
      });

    it('keeps the newest draft per language', async () => {
      const lead = await seedLead();
      await seedDraft(lead.id, 'en');
      await seedDraft(lead.id, 'hi');

      const latest = await repos.drafts.latestByLanguageForLead(lead.id);
      expect(Object.keys(latest).sort()).toEqual(['en', 'hi']);
      expect(latest.en?.whatsappText).toBe('Draft in en');
    });

    it('returns the newest when a language was drafted twice', async () => {
      const lead = await seedLead();
      await repos.drafts.create({
        leadId: lead.id,
        language: 'en',
        whatsappText: 'old',
        generatedBy: 'llm',
        tokensIn: 1,
        tokensOut: 1,
        latencyMs: 1,
        grounded: true,
        validationErrors: [],
      });
      // Distinct timestamps: the ordering must not depend on insertion order
      // when two drafts share a creation millisecond.
      await repos.drafts.create({
        leadId: lead.id,
        language: 'en',
        whatsappText: 'new',
        generatedBy: 'llm',
        tokensIn: 1,
        tokensOut: 1,
        latencyMs: 1,
        grounded: true,
        validationErrors: [],
      });

      const rows = await repos.drafts.listForLead(lead.id);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.whatsappText).toBe('new');
    });

    it('tracks grounding and fallback counts', async () => {
      const lead = await seedLead();
      await seedDraft(lead.id, 'en', true);
      await seedDraft(lead.id, 'hi', true);
      await seedDraft(lead.id, 'hinglish', false);

      const stats = await repos.drafts.groundingStats();
      expect(stats.total).toBe(3);
      expect(stats.grounded).toBe(2);
      expect(stats.llm).toBe(2);
      expect(stats.fallback).toBe(1);
    });

    it('sums tokens', async () => {
      const lead = await seedLead();
      await seedDraft(lead.id, 'en');
      await seedDraft(lead.id, 'hi');

      expect(await repos.drafts.tokenTotals()).toEqual({ tokensIn: 200, tokensOut: 100 });
    });

    it('records an approval timestamp', async () => {
      const lead = await seedLead();
      const draft = await seedDraft(lead.id, 'en');
      expect(draft.approvedAt).toBeNull();

      const approved = await repos.drafts.markApproved(draft.id);
      expect(approved.approvedAt).not.toBeNull();
    });
  });

  describe('contact log repository', () => {
    it('records an outreach event', async () => {
      const lead = await seedLead();
      await repos.contactLog.add({
        leadId: lead.id,
        channel: 'whatsapp',
        event: 'sent',
        note: 'Sent the short message.',
      });

      const entries = await repos.contactLog.listForLead(lead.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.event).toBe('sent');
      expect(entries[0]?.note).toBe('Sent the short message.');
    });

    it('computes milestones from recorded events', async () => {
      const lead = await seedLead();
      expect(await repos.contactLog.milestones()).toEqual({
        firstMessageSent: false,
        firstReply: false,
        firstMeeting: false,
        firstClient: false,
      });

      await repos.contactLog.add({ leadId: lead.id, channel: 'whatsapp', event: 'sent' });
      await repos.contactLog.add({ leadId: lead.id, channel: 'whatsapp', event: 'replied' });

      expect(await repos.contactLog.milestones()).toEqual({
        firstMessageSent: true,
        firstReply: true,
        firstMeeting: false,
        firstClient: false,
      });
    });

    it('returns the newest entries first', async () => {
      const lead = await seedLead();
      await repos.contactLog.add({
        leadId: lead.id,
        channel: 'whatsapp',
        event: 'sent',
        at: new Date('2026-10-01T10:00:00Z'),
      });
      await repos.contactLog.add({
        leadId: lead.id,
        channel: 'email',
        event: 'replied',
        at: new Date('2026-10-05T10:00:00Z'),
      });

      const entries = await repos.contactLog.listForLead(lead.id);
      expect(entries[0]?.event).toBe('replied');
    });
  });

  describe('run repository', () => {
    it('creates a run in queued state with a start time', async () => {
      const run = await repos.runs.create({
        query: 'plumbers',
        location: 'Bhopal',
        limit: 20,
        language: 'en',
      });

      expect(run.status).toBe('queued');
      expect(run.startedAt).not.toBeNull();
      expect(run.leadsFound).toBe(0);
    });

    it('accumulates counters across several updates', async () => {
      const run = await repos.runs.create({ query: 'a', location: 'b', limit: 5, language: 'en' });

      await repos.runs.addCounters(run.id, { leadsFound: 3, serpapiCalls: 1 });
      await repos.runs.addCounters(run.id, { leadsFound: 2, auditsOk: 3, tokensOut: 120 });

      const stored = await repos.runs.requireById(run.id);
      expect(stored.leadsFound).toBe(5);
      expect(stored.serpapiCalls).toBe(1);
      expect(stored.auditsOk).toBe(3);
      expect(stored.tokensOut).toBe(120);
      // Untouched counters stay at their default.
      expect(stored.tokensIn).toBe(0);
    });

    it('ignores an empty counter update', async () => {
      const run = await repos.runs.create({ query: 'a', location: 'b', limit: 5, language: 'en' });
      await repos.runs.addCounters(run.id, {});
      expect((await repos.runs.requireById(run.id)).leadsFound).toBe(0);
    });

    it('marks a finished run with a finish time', async () => {
      const run = await repos.runs.create({ query: 'a', location: 'b', limit: 5, language: 'en' });
      await repos.runs.setStatus(run.id, 'completed');

      const stored = await repos.runs.requireById(run.id);
      expect(stored.status).toBe('completed');
      expect(stored.finishedAt).not.toBeNull();
    });

    it('stores a failure reason', async () => {
      const run = await repos.runs.create({ query: 'a', location: 'b', limit: 5, language: 'en' });
      await repos.runs.setStatus(run.id, 'failed', 'SerpApi returned an error.');

      expect((await repos.runs.requireById(run.id)).error).toContain('SerpApi');
    });

    it('finds the single active run', async () => {
      expect(await repos.runs.activeRun()).toBeUndefined();

      const running = await repos.runs.create({
        query: 'a',
        location: 'b',
        limit: 5,
        language: 'en',
      });
      const done = await repos.runs.create({ query: 'c', location: 'd', limit: 5, language: 'en' });
      await repos.runs.setStatus(done.id, 'completed');

      expect((await repos.runs.activeRun())?.id).toBe(running.id);
    });

    it('totals counters across runs for the metrics endpoint', async () => {
      const first = await repos.runs.create({
        query: 'a',
        location: 'b',
        limit: 5,
        language: 'en',
      });
      const second = await repos.runs.create({
        query: 'c',
        location: 'd',
        limit: 5,
        language: 'hi',
      });
      await repos.runs.addCounters(first.id, { leadsFound: 10, serpapiCalls: 1, tokensIn: 500 });
      await repos.runs.addCounters(second.id, { leadsFound: 4, serpapiCalls: 1, tokensIn: 200 });

      const totals = await repos.runs.totals();
      expect(totals.runs).toBe(2);
      expect(totals.leadsFound).toBe(14);
      expect(totals.serpapiCalls).toBe(2);
      expect(totals.tokensIn).toBe(700);
    });

    it('returns zeroed totals when there are no runs', async () => {
      const totals = await repos.runs.totals();
      expect(totals.runs).toBe(0);
      expect(totals.leadsFound).toBe(0);
    });
  });
});
