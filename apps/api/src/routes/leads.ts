import { z } from 'zod';
import { auditWebsite, generateDraft, type Language } from '@localscout/core';
import type { Hono } from 'hono';
import type { AppRuntime } from '../runtime.js';

/**
 * Lead, draft and outreach-log endpoints.
 *
 * Every handler validates its input with zod before touching the database, and
 * every response is shaped for the browser. Nothing here returns a secret: the
 * health endpoint reports whether a key is set, never its value.
 */

const LEAD_STATUSES = [
  'discovered',
  'audited',
  'drafted',
  'approved',
  'sent',
  'replied',
  'won',
  'lost',
  'skipped',
] as const;

const listQuerySchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(['score', 'newest', 'name']).default('score'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const patchLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  notes: z.string().max(4000).optional(),
  skipReason: z.string().max(500).optional(),
});

const draftRequestSchema = z.object({
  language: z.enum(['en', 'hinglish', 'hi']),
});

const contactLogSchema = z.object({
  channel: z.enum(['whatsapp', 'email', 'call', 'visit']),
  event: z.enum(['sent', 'replied', 'meeting', 'won', 'lost', 'note']),
  note: z.string().max(2000).optional(),
  at: z.coerce.date().optional(),
});

export function registerLeadRoutes(app: Hono, runtime: AppRuntime): void {
  const { repos, config, provider, sender, reportDir } = runtime;

  app.get('/api/leads', async (c) => {
    // hono's query() returns a plain record; zod wants a real object. The cast is
    // to the iterable overload rather than a cast to any, which the lint rules
    // forbid and which would hide a genuine shape error.
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(Object.entries(c.req.query() as Record<string, string>)),
    );
    if (!parsed.success) {
      return c.json({ error: 'Check the filters.', issues: parsed.error.issues }, 400);
    }

    const filters = parsed.data;

    // One set of conditions, used for the page and for its total. A total
    // computed from different conditions than the rows it counts is worse than
    // no total: it is a number that looks like an answer.
    const matching = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.minScore !== undefined ? { minScore: filters.minScore } : {}),
      ...(filters.q ? { q: filters.q } : {}),
    };

    const leads = await repos.leads.list({
      ...matching,
      sort: filters.sort,
      limit: filters.limit,
      offset: filters.offset,
    });

    const total = await repos.leads.count(matching);
    return c.json({ leads, total });
  });

  app.get('/api/leads/:id', async (c) => {
    // `summaryById`, not `byId`: the single-lead response has to carry the same
    // score, status and WhatsApp flag as the list, or a lead shows a number in
    // the grid and a blank in its own modal.
    const lead = await repos.leads.summaryById(c.req.param('id'));
    if (!lead) return c.json({ error: `No lead with id ${c.req.param('id')}.` }, 404);

    /*
     * No status counts here. They used to be returned on this response and read
     * by nothing, which meant every modal open ran a GROUP BY over the whole
     * leads table to build an object that was then discarded. The dashboard's
     * numbers come from `/api/metrics`, which is where a table-wide aggregate
     * belongs.
     */
    const [audit, drafts, log] = await Promise.all([
      repos.audits.latestForLead(lead.id),
      repos.drafts.latestByLanguageForLead(lead.id),
      repos.contactLog.listForLead(lead.id),
    ]);

    return c.json({ lead, audit: audit ?? null, drafts, contactLog: log });
  });

  app.patch('/api/leads/:id', async (c) => {
    const parsed = patchLeadSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Check the update.', issues: parsed.error.issues }, 400);
    }

    const lead = await repos.leads.byId(c.req.param('id'));
    if (!lead) return c.json({ error: `No lead with id ${c.req.param('id')}.` }, 404);

    const { status, notes, skipReason } = parsed.data;

    if (status !== undefined) {
      // "Sent" is what the human asserts, so it is recorded as an outreach
      // event rather than only a status change. Localscout never sends
      // anything itself; this is the user telling it what they did.
      if (status === 'sent' && lead.status !== 'sent') {
        await repos.contactLog.add({
          leadId: lead.id,
          channel: lead.phoneIsMobile ? 'whatsapp' : 'email',
          event: 'sent',
          note: 'Marked as sent from the leads list.',
        });
      }
      await repos.leads.setStatus(lead.id, status, skipReason);
    }

    if (notes !== undefined) {
      await repos.leads.setNotes(lead.id, notes);
    }

    return c.json({ lead: await repos.leads.requireById(lead.id) });
  });

  app.post('/api/leads/:id/contact-log', async (c) => {
    const parsed = contactLogSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Check the entry.', issues: parsed.error.issues }, 400);
    }

    const lead = await repos.leads.byId(c.req.param('id'));
    if (!lead) return c.json({ error: `No lead with id ${c.req.param('id')}.` }, 404);

    const entry = await repos.contactLog.add({
      leadId: lead.id,
      ...parsed.data,
    });

    // Logging an outcome moves the lead with it, so the list never disagrees
    // with the outreach book.
    const statusForEvent: Record<string, typeof lead.status | undefined> = {
      sent: 'sent',
      replied: 'replied',
      won: 'won',
      lost: 'lost',
    };
    const next = statusForEvent[parsed.data.event];
    if (next !== undefined && next !== lead.status) {
      await repos.leads.setStatus(lead.id, next);
    }

    return c.json({ entry, lead: await repos.leads.requireById(lead.id) }, 201);
  });

  app.post('/api/leads/:id/drafts', async (c) => {
    const parsed = draftRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Pick a language: en, hinglish or hi.' }, 400);
    }

    const lead = await repos.leads.byId(c.req.param('id'));
    if (!lead) return c.json({ error: `No lead with id ${c.req.param('id')}.` }, 404);

    const audit = await repos.audits.latestForLead(lead.id);
    if (!audit) {
      return c.json(
        {
          error:
            'This lead has not been audited yet, so there is nothing to base a draft on. Run the audit first.',
        },
        409,
      );
    }

    const outcome = await generateDraft(
      {
        businessName: lead.name,
        ...(lead.category ? { category: lead.category } : {}),
        language: parsed.data.language as Language,
        findings: audit.findings,
        sender,
        ...(lead.websiteUrl ? { websiteUrl: lead.websiteUrl } : {}),
        ...(lead.phoneE164 ? { phoneE164: lead.phoneE164 } : {}),
        ...(lead.rating !== null
          ? { allowedNumbers: [String(lead.rating), String(lead.reviewCount ?? '')] }
          : {}),
      },
      { provider },
    );

    const saved = await repos.drafts.create({
      leadId: lead.id,
      auditId: audit.id,
      language: parsed.data.language as Language,
      whatsappText: outcome.whatsapp,
      emailSubject: outcome.email_subject,
      emailBody: outcome.email_body,
      generatedBy: outcome.generated_by,
      model: outcome.model,
      tokensIn: outcome.tokens_in,
      tokensOut: outcome.tokens_out,
      latencyMs: outcome.latency_ms,
      grounded: outcome.grounded,
      validationErrors: outcome.validation_errors,
    });

    if (lead.status === 'audited' || lead.status === 'discovered') {
      await repos.leads.setStatus(lead.id, 'drafted');
    }

    return c.json({ draft: saved, lead: await repos.leads.requireById(lead.id) }, 201);
  });

  app.post('/api/leads/:id/audit', async (c) => {
    const lead = await repos.leads.byId(c.req.param('id'));
    if (!lead) return c.json({ error: `No lead with id ${c.req.param('id')}.` }, 404);

    const audited = await auditWebsite(
      {
        websiteUrl: lead.websiteUrl ?? undefined,
        rating: lead.rating ?? undefined,
        reviewCount: lead.reviewCount ?? undefined,
      },
      {
        timeoutMs: config.audit.timeoutMs,
        reportDir,
        ...(config.audit.chromePath ? { chromePath: config.audit.chromePath } : {}),
      },
    );

    if (audited.value === undefined) {
      return c.json({ error: audited.error?.message ?? 'The audit could not be completed.' }, 502);
    }

    const row = await repos.audits.create({
      leadId: lead.id,
      status: audited.value.status,
      startedAt: new Date(Date.now() - audited.value.durationMs),
      durationMs: audited.value.durationMs,
      metrics: audited.value.metrics,
      checks: audited.value.checks,
      findings: audited.value.findings,
      opportunityScore: audited.value.opportunityScore,
      ...(audited.error ? { error: audited.error.message } : {}),
      ...(audited.value.reportPath ? { reportPath: audited.value.reportPath } : {}),
    });

    if (lead.status === 'discovered') {
      await repos.leads.setStatus(lead.id, 'audited');
    }

    return c.json({ audit: row, lead: await repos.leads.requireById(lead.id) });
  });
}
