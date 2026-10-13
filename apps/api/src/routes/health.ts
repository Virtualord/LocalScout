import type { Hono } from 'hono';
import { findChrome, OllamaProvider, pingDb } from '@localscout/core';
import type { AppRuntime } from '../runtime.js';

/**
 * Health and metrics.
 *
 * `/api/health` answers "what do I need to fix?" rather than "is everything
 * green?", because on a first run the answer is usually a list of things. Each
 * check returns a plain-language `fix` when it is not satisfied.
 *
 * Neither endpoint ever returns a secret. The SerpApi and LLM keys are reported
 * as booleans, and the health check deliberately does not echo the base url of
 * a private endpoint beyond what the user already configured.
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** What to do about it, when not ok. */
  fix?: string;
}

export function registerHealthRoutes(app: Hono, runtime: AppRuntime): void {
  app.get('/api/health', async (c) => {
    const { config, db } = runtime;
    const checks: Check[] = [];

    checks.push(
      pingDb(db.sqlite)
        ? { name: 'database', ok: true, detail: `SQLite at ${runtime.databaseUrl}` }
        : {
            name: 'database',
            ok: false,
            detail: 'The local database is not readable.',
            fix: 'Check that DATA_DIR is writable, then restart.',
          },
    );

    const chrome = await findChrome(config.audit.chromePath);
    checks.push(
      chrome.path !== undefined
        ? { name: 'chrome', ok: true, detail: `Lighthouse will run with ${chrome.path}` }
        : {
            name: 'chrome',
            // Not fatal: the audit still runs its HTTP and HTML checks.
            ok: false,
            detail: 'Chrome was not found, so Lighthouse will not run.',
            fix: `${chrome.message} Performance numbers will be absent until then.`,
          },
    );

    if (config.llm.provider === 'ollama') {
      const provider = new OllamaProvider({
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        timeoutMs: config.llm.timeoutMs,
      });
      const status = await provider.health();
      checks.push(
        status.reachable && status.modelPresent
          ? { name: 'llm', ok: true, detail: status.message }
          : {
              name: 'llm',
              ok: false,
              detail: status.message,
              fix: status.reachable
                ? status.message
                : 'Start it with "ollama serve", or set LLM_PROVIDER=fixture to use recorded drafts.',
            },
      );
    } else {
      checks.push({
        name: 'llm',
        ok: true,
        detail: `Using the ${config.llm.provider} provider with ${config.llm.model}.`,
      });
    }

    checks.push(
      config.discovery.serpApiKey !== undefined
        ? {
            name: 'discovery',
            ok: true,
            // Presence only. The value is a paid credential.
            detail: 'A SerpApi key is set, so live searches are available.',
          }
        : {
            name: 'discovery',
            ok: true,
            detail: 'Using recorded fixtures (DISCOVERY_MODE=fixtures).',
            fix: 'Add SERPAPI_API_KEY to .env and set DISCOVERY_MODE=live to search real businesses.',
          },
    );

    const blocking = checks.filter((check) => !check.ok && check.name === 'database');

    return c.json(
      {
        ok: blocking.length === 0,
        checks,
        modes: {
          discovery: config.discovery.mode,
          llm: config.llm.provider,
        },
        // Present-only flags, so a client can show "key set" without the key.
        keys: {
          serpApi: config.discovery.serpApiKey !== undefined,
          llm: config.llm.apiKey !== undefined,
        },
      },
      blocking.length === 0 ? 200 : 503,
    );
  });

  app.get('/api/metrics', async (c) => {
    const { repos } = runtime;

    const [
      runTotals,
      leadTotal,
      auditCounts,
      avgAuditMs,
      grounding,
      avgDraftMs,
      tokens,
      milestones,
      statusCounts,
      contactTotal,
    ] = await Promise.all([
      repos.runs.totals(),
      repos.leads.total(),
      repos.audits.countByStatus(),
      repos.audits.averageDurationMs(),
      repos.drafts.groundingStats(),
      repos.drafts.averageLatencyMs(),
      repos.drafts.tokenTotals(),
      repos.contactLog.milestones(),
      repos.leads.countByStatus(),
      repos.contactLog.total(),
    ]);

    // Grounding pass rate split by how the draft was obtained, which is the
    // number the write-up needs: a high fallback rate with a high overall
    // grounded rate is a very different story from the reverse.
    const draftsTotal = Math.max(1, grounding.total);
    const fallbackRate = Math.round((grounding.fallback / draftsTotal) * 100);
    const llmRate = Math.round((grounding.llm / draftsTotal) * 100);

    const auditsRun = auditCounts.ok + auditCounts.stale + auditCounts.unavailable;

    return c.json({
      leads: {
        total: leadTotal,
        byStatus: statusCounts,
      },
      runs: runTotals,
      audits: {
        total: auditsRun,
        byStatus: auditCounts,
        averageDurationMs: avgAuditMs,
      },
      drafts: {
        total: grounding.total,
        fromModel: grounding.llm,
        fromTemplate: grounding.fallback,
        grounded: grounding.grounded,
        groundedPercent: Math.round((grounding.grounded / draftsTotal) * 100),
        modelRatePercent: llmRate,
        fallbackRatePercent: fallbackRate,
        averageLatencyMs: avgDraftMs,
        tokensIn: tokens.tokensIn,
        tokensOut: tokens.tokensOut,
      },
      cost: {
        /**
         * SerpApi charges per search, so cost per lead is searches per lead.
         * LLM cost is zero locally: the model runs on the user's machine.
         */
        serpApiCalls: runTotals.serpapiCalls,
        serpApiCallsPerLead:
          leadTotal === 0 ? null : Number((runTotals.serpapiCalls / leadTotal).toFixed(4)),
        llmCostPerLead: 0,
        note: 'SerpApi bills per search. Local inference through Ollama has no marginal cost.',
      },
      outreach: {
        totalEntries: contactTotal,
        milestones,
      },
    });
  });
}
