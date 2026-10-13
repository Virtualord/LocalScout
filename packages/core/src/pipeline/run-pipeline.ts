import { auditWebsite, type AuditConfig, type AuditResult } from '../audit/audit.js';
import type { AppConfig } from '../config/env.js';
import type { AuditCheck, AuditMetrics, Language, StoredFinding } from '../db/schema.js';
import type { Repositories } from '../db/repositories/index.js';
import { generateDraft } from '../draft/generate.js';
import type { LlmProvider } from '../draft/provider.js';
import type { SenderProfile } from '../draft/fallback.js';
import { dedupeListings, discover, type DiscoverOptions } from '../discovery/discover.js';
import type { Lead } from '../db/schema.js';
import { computeDomainKey } from '../discovery/domain-key.js';
import type { Logger } from 'pino';
import type { SourceResult } from '../result/source-result.js';
import type { Emit } from './events.js';

/**
 * The pipeline.
 *
 * All step logic lives here as a plain async function with injected
 * dependencies, so it is testable without a framework, a database file, or a
 * network. The Mastra workflow in `apps/api` is a thin shell that supplies the
 * real dependencies and maps the steps onto its own typed stages; a framework
 * quirk therefore cannot trap the logic, only the shell.
 *
 * Ordering is deliberate:
 *
 * 1. **discover** then **dedupe**, so quota is spent before anything is filtered.
 * 2. **audit** concurrently, bounded, because these are network round trips and
 *    a 50-lead run is otherwise minutes of waiting.
 * 3. **draft** sequentially, because a local model serves one request well at a
 *    time and parallel calls would queue inside the model, not speed it up.
 *
 * A failure in one lead never aborts the run: the lead is recorded as failed and
 * the others continue. That is the difference between a tool a freelancer trusts
 * with their one shot at a city and a tool they run once and never again.
 */

export interface PipelineInput {
  runId: string;
  query: string;
  location: string;
  limit: number;
  language: Language;
}

export interface PipelineDeps {
  config: AppConfig;
  repos: Repositories;
  logger: Logger;
  emit: Emit;
  provider: LlmProvider;
  sender: SenderProfile;
  /** Overrides for tests, chiefly the fetch resolver. */
  auditConfig?: Partial<AuditConfig>;
  discoverOptions?: Partial<DiscoverOptions>;
}

export interface LeadOutcome {
  leadId: string;
  name: string;
  status: 'audited' | 'skipped' | 'failed';
  opportunityScore: number;
  /** Finding ids, used by the eval harness and the write-up. */
  findingIds: string[];
  draftId?: string;
  generatedBy?: 'llm' | 'fallback';
  grounded?: boolean;
  error?: string;
}

export interface PipelineResult {
  runId: string;
  status: 'completed' | 'failed';
  leadsFound: number;
  leadsNew: number;
  skippedDuplicates: number;
  skippedContacted: number;
  auditsOk: number;
  auditsFailed: number;
  draftsLlm: number;
  draftsFallback: number;
  tokensIn: number;
  tokensOut: number;
  serpApiCalls: number;
  outcomes: LeadOutcome[];
  error?: string;
}

/**
 * Run one search end to end.
 *
 * Never throws for a per-lead problem. A failure that stops the whole run (a
 * configuration error, say) is caught by the caller and recorded on the run row.
 */
export async function runPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { config, repos, logger, emit } = deps;
  const startedAt = Date.now();

  const result: PipelineResult = {
    runId: input.runId,
    status: 'completed',
    leadsFound: 0,
    leadsNew: 0,
    skippedDuplicates: 0,
    skippedContacted: 0,
    auditsOk: 0,
    auditsFailed: 0,
    draftsLlm: 0,
    draftsFallback: 0,
    tokensIn: 0,
    tokensOut: 0,
    serpApiCalls: 0,
    outcomes: [],
  };

  emit({
    type: 'run.started',
    message: `Searching for ${input.query} in ${input.location}`,
    data: { query: input.query, location: input.location, limit: input.limit },
  });

  await repos.runs.setStatus(input.runId, 'running');

  // ---- discover -----------------------------------------------------------
  logger.info({ query: input.query, location: input.location }, 'discovery.start');

  const discovery = await discover({
    mode: config.discovery.mode,
    query: input.query,
    location: input.location,
    country: config.app.defaultCountry,
    limit: input.limit,
    ...(config.discovery.serpApiKey ? { serpApiKey: config.discovery.serpApiKey } : {}),
    ...(config.discovery.cacheDir ? { cacheDir: config.discovery.cacheDir } : {}),
    ...deps.discoverOptions,
  });

  if (discovery.value === undefined) {
    // Nothing was discovered, so nothing can be audited. Fail the run honestly.
    const message = discovery.error?.message ?? 'Discovery returned nothing.';
    logger.error({ code: discovery.error?.code }, 'discovery.failed');
    await repos.runs.setStatus(input.runId, 'failed', message);

    emit({ type: 'run.failed', message, data: { code: discovery.error?.code } });
    return { ...result, status: 'failed', error: message };
  }

  result.leadsFound = discovery.value.listings.length;
  result.serpApiCalls = discovery.value.serpApiCalls;

  logger.info(
    {
      found: result.leadsFound,
      source: discovery.value.source,
      degraded: discovery.value.degraded,
    },
    'discovery.end',
  );

  // ---- dedupe -------------------------------------------------------------
  const deduped = await dedupeListings({ listings: discovery.value.listings, repo: repos.leads });
  result.skippedDuplicates = deduped.duplicatePlaceId.length;
  result.skippedContacted = deduped.alreadyContacted.length;

  for (const listing of deduped.duplicatePlaceId) {
    emit({
      type: 'lead.skipped',
      message: `${listing.name} was already found in an earlier search`,
      data: { placeId: listing.placeId, reason: 'duplicate_place_id' },
    });
  }
  for (const listing of deduped.alreadyContacted) {
    emit({
      type: 'lead.skipped',
      message: `${listing.name} was already contacted`,
      data: { placeId: listing.placeId, reason: 'already_contacted' },
    });
  }

  // ---- persist discoveries ------------------------------------------------
  const leads = await repos.leads.insertMany(
    deduped.fresh.map((listing) => ({
      placeId: listing.placeId,
      name: listing.name,
      category: listing.category,
      address: listing.address,
      lat: listing.lat,
      lng: listing.lng,
      phone: listing.phone,
      phoneE164: listing.phoneE164,
      phoneIsMobile: listing.phoneIsMobile,
      websiteUrl: listing.websiteUrl,
      domainKey: listing.domainKey ?? computeDomainKey(listing.websiteUrl),
      rating: listing.rating,
      reviewCount: listing.reviewCount,
      sourceRunId: input.runId,
    })),
  );
  result.leadsNew = leads.length;

  for (const lead of leads) {
    emit({
      type: 'lead.discovered',
      leadId: lead.id,
      message: `Found ${lead.name}`,
      data: { name: lead.name, category: lead.category, websiteUrl: lead.websiteUrl },
    });
  }

  if (leads.length === 0) {
    const message =
      result.skippedDuplicates + result.skippedContacted > 0
        ? `No new leads. ${result.skippedDuplicates} already found, ${result.skippedContacted} already contacted.`
        : `No leads found for ${input.query} in ${input.location}.`;

    await repos.runs.setStatus(input.runId, 'completed');
    emit({ type: 'run.finished', message, data: summarise(result) });
    return result;
  }

  // ---- audit (concurrent, bounded) ----------------------------------------
  const audited = await auditAll(leads, input.language, deps);

  for (const item of audited) {
    result.outcomes.push(item.outcome);
    if (item.outcome.status === 'audited') {
      result.auditsOk += 1;
      if (item.outcome.generatedBy === 'llm') result.draftsLlm += 1;
      else if (item.outcome.generatedBy === 'fallback') result.draftsFallback += 1;
      result.tokensIn += item.tokensIn;
      result.tokensOut += item.tokensOut;
    } else {
      result.auditsFailed += 1;
    }
  }

  // ---- record counters ----------------------------------------------------
  await repos.runs.addCounters(input.runId, {
    serpapiCalls: result.serpApiCalls,
    leadsFound: result.leadsFound,
    leadsNew: result.leadsNew,
    auditsOk: result.auditsOk,
    auditsFailed: result.auditsFailed,
    draftsLlm: result.draftsLlm,
    draftsFallback: result.draftsFallback,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  });

  await repos.runs.setStatus(input.runId, 'completed');

  const elapsedMs = Date.now() - startedAt;
  logger.info({ ...summarise(result), elapsedMs }, 'run.end');

  emit({
    type: 'run.finished',
    message: `Finished in ${Math.round(elapsedMs / 1000)}s: ${result.auditsOk} audited, ${result.draftsLlm + result.draftsFallback} drafts ready`,
    data: { ...summarise(result), elapsedMs },
  });

  return result;
}

interface AuditedItem {
  outcome: LeadOutcome;
  tokensIn: number;
  tokensOut: number;
}

type AuditOutcome = SourceResult<AuditResult>;

/** Audit a lead that has a website of its own. */
async function auditWithSite(
  lead: Lead,
  deps: PipelineDeps,
  reportDir: string,
  emit: Emit,
): Promise<AuditOutcome | undefined> {
  const { config } = deps;

  emit({
    type: 'audit.started',
    leadId: lead.id,
    message: `Checking ${lead.name}`,
    data: { websiteUrl: lead.websiteUrl },
  });
  deps.logger.child({ leadId: lead.id }).info({ websiteUrl: lead.websiteUrl }, 'audit.start');

  return auditWebsite(
    {
      websiteUrl: lead.websiteUrl as string,
      rating: lead.rating ?? undefined,
      reviewCount: lead.reviewCount ?? undefined,
    },
    {
      timeoutMs: config.audit.timeoutMs,
      reportDir,
      ...(config.audit.chromePath ? { chromePath: config.audit.chromePath } : {}),
      ...deps.auditConfig,
    },
  );
}

/**
 * Audit a lead with no site of its own.
 *
 * Lighthouse is skipped because there is no page to measure; the HTML checks
 * would all fail on an absent site, which would misreport a missing website as
 * a broken one.
 */
async function auditWithoutSite(
  lead: Lead,
  deps: PipelineDeps,
  reportDir: string,
): Promise<AuditOutcome> {
  return auditWebsite(
    {
      websiteUrl: undefined,
      rating: lead.rating ?? undefined,
      reviewCount: lead.reviewCount ?? undefined,
    },
    { timeoutMs: deps.config.audit.timeoutMs, reportDir, skipLighthouse: true },
  );
}

/** Store an audit outcome, including its failure reason when there was one. */
async function persistAudit(
  leadId: string,
  result: AuditResult,
  errorMessage: string | undefined,
  repos: Repositories,
): Promise<void> {
  await repos.audits.create({
    leadId,
    status: result.status,
    startedAt: new Date(Date.now() - result.durationMs),
    durationMs: result.durationMs,
    metrics: result.metrics,
    checks: result.checks,
    findings: result.findings,
    opportunityScore: result.opportunityScore,
    ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    ...(result.reportPath !== undefined ? { reportPath: result.reportPath } : {}),
  });
}

/**
 * Audit and draft every lead, audits in parallel and drafts in sequence.
 *
 * Two separate passes on purpose: auditing is I/O bound across different hosts,
 * while drafting contends for one local model.
 */
async function auditAll(
  leads: Lead[],
  language: Language,
  deps: PipelineDeps,
): Promise<AuditedItem[]> {
  const { config, repos, logger, emit, provider, sender } = deps;
  const concurrency = Math.max(1, config.audit.concurrency);
  const reportDir = `${config.app.dataDir}/reports`;

  // --- pass one: audit, bounded concurrency ---
  const auditResults = new Map<
    string,
    {
      findings: StoredFinding[];
      score: number;
      checks: AuditCheck[];
      metrics: AuditMetrics;
      email?: string;
    }
  >();

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, leads.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const lead = leads[index];
      if (!lead) return;

      const leadLogger = logger.child({ leadId: lead.id });

      const hasRealSite =
        lead.websiteUrl !== null &&
        lead.websiteUrl !== undefined &&
        computeDomainKey(lead.websiteUrl) !== undefined;

      // Both branches persist an audit row. A business with no site of its own
      // is still a measured outcome: NO_WEBSITE is a finding, and storing it is
      // what gives the lead a score in the list rather than a blank row.
      const audited = hasRealSite
        ? await auditWithSite(lead, deps, reportDir, emit)
        : await auditWithoutSite(lead, deps, reportDir);

      if (audited === undefined || audited.value === undefined) {
        /*
         * A failed audit still gets a row.
         *
         * The temptation is to store nothing, because storing an empty audit
         * could look like a clean bill of health. But an absent row is worse:
         * "never audited" and "audited, could not reach the site" then look
         * identical, and the lead screen has to guess which happened. `unavailable`
         * is already a first-class audit status and the error column already
         * exists precisely for this. The row carries no metrics and no findings,
         * so it cannot be mistaken for a measurement.
         */
        leadLogger.warn({ code: audited?.error?.code }, 'audit.failed');

        await repos.audits.create({
          leadId: lead.id,
          status: 'unavailable',
          startedAt: new Date(),
          durationMs: audited?.meta.durationMs ?? 0,
          metrics: {},
          checks: [],
          findings: [],
          /*
           * The column is NOT NULL so a row can exist at all, and for a failed
           * audit its value is meaningless. The lead repository reads an
           * `unavailable` audit as a null score, so this zero is a storage
           * placeholder and never reaches a screen.
           */
          opportunityScore: 0,
          error: audited?.error?.message ?? 'The audit produced no result and no reason.',
        });

        // The lead keeps its `discovered` status: it was not successfully
        // audited, and promoting it would misrepresent the funnel.
        continue;
      }

      await persistAudit(lead.id, audited.value, audited.error?.message, repos);

      // A public email read from the site's own mailto is the only place this
      // field is ever written.
      if (audited.value.contactEmail) {
        await repos.leads.setContactEmail(lead.id, audited.value.contactEmail);
      }

      await repos.leads.setStatus(lead.id, 'audited');

      auditResults.set(lead.id, {
        findings: audited.value.findings,
        score: audited.value.opportunityScore,
        checks: audited.value.checks,
        metrics: audited.value.metrics,
        ...(audited.value.contactEmail ? { email: audited.value.contactEmail } : {}),
      });

      leadLogger.info(
        { score: audited.value.opportunityScore, findings: audited.value.findings.length },
        'audit.end',
      );
    }
  });

  await Promise.all(workers);

  // --- pass two: draft, sequential ---
  const items: AuditedItem[] = [];

  for (const lead of leads) {
    const audited = auditResults.get(lead.id);

    if (!audited) {
      // Either the site was unreachable or the audit threw. The lead stays in
      // the list with no score so the user can see it and re-run it.
      emit({
        type: 'audit.finished',
        leadId: lead.id,
        message: `Could not check ${lead.name}`,
        data: { status: 'unavailable' },
      });
      items.push({
        outcome: {
          leadId: lead.id,
          name: lead.name,
          status: 'failed',
          opportunityScore: 0,
          findingIds: [],
        },
        tokensIn: 0,
        tokensOut: 0,
      });
      continue;
    }

    emit({
      type: 'audit.finished',
      leadId: lead.id,
      message: `Scored ${lead.name}`,
      data: {
        score: audited.score,
        findings: audited.findings.map((finding) => finding.id),
        hasWebsite: !audited.findings.some((finding) => finding.id === 'NO_WEBSITE'),
      },
    });

    const draft = await generateDraft(
      {
        businessName: lead.name,
        ...(lead.category ? { category: lead.category } : {}),
        language,
        findings: audited.findings,
        sender,
        ...(lead.websiteUrl ? { websiteUrl: lead.websiteUrl } : {}),
        ...(lead.phoneE164 ? { phoneE164: lead.phoneE164 } : {}),
      },
      { provider },
    );

    const auditRow = await repos.audits.latestForLead(lead.id);
    const saved = await repos.drafts.create({
      leadId: lead.id,
      ...(auditRow ? { auditId: auditRow.id } : {}),
      language,
      whatsappText: draft.whatsapp,
      emailSubject: draft.email_subject,
      emailBody: draft.email_body,
      generatedBy: draft.generated_by,
      model: draft.model,
      tokensIn: draft.tokens_in,
      tokensOut: draft.tokens_out,
      latencyMs: draft.latency_ms,
      grounded: draft.grounded,
      validationErrors: draft.validation_errors,
    });

    await repos.leads.setStatus(lead.id, 'drafted');

    emit({
      type: 'draft.finished',
      leadId: lead.id,
      message: `Draft ready for ${lead.name}`,
      data: {
        draftId: saved.id,
        generatedBy: draft.generated_by,
        grounded: draft.grounded,
        whatsappChars: draft.whatsapp.length,
      },
    });

    items.push({
      outcome: {
        leadId: lead.id,
        name: lead.name,
        status: 'audited',
        opportunityScore: audited.score,
        findingIds: audited.findings.map((finding) => finding.id),
        draftId: saved.id,
        generatedBy: draft.generated_by,
        grounded: draft.grounded,
      },
      tokensIn: draft.tokens_in,
      tokensOut: draft.tokens_out,
    });
  }

  return items;
}

function summarise(result: PipelineResult): Record<string, unknown> {
  return {
    leadsFound: result.leadsFound,
    leadsNew: result.leadsNew,
    skippedDuplicates: result.skippedDuplicates,
    skippedContacted: result.skippedContacted,
    auditsOk: result.auditsOk,
    auditsFailed: result.auditsFailed,
    draftsLlm: result.draftsLlm,
    draftsFallback: result.draftsFallback,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    serpApiCalls: result.serpApiCalls,
  };
}
