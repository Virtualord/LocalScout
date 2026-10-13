import { writeFileSync } from 'node:fs';
import type { Language, StoredFinding } from '../db/schema.js';
import { generateDraft } from '../draft/generate.js';
import { validateGrounding } from '../draft/grounding.js';
import { buildUserPrompt, SYSTEM_PROMPT } from '../draft/prompt.js';
import { draftOutputSchema } from '../draft/provider.js';
import { OllamaProvider } from '../draft/providers.js';

/**
 * A real round trip against a local Ollama.
 *
 * Run with: EVAL_MODELS=gemma3:4b pnpm eval
 *
 * This is deliberately not part of `pnpm test`: it needs a model on disk and
 * takes tens of seconds per draft, so CI cannot run it. Its output is the
 * evidence for the write-up's "where open models worked" section, which is a
 * claim that has to be measured rather than asserted.
 */

export interface EvalCase {
  id: string;
  businessName: string;
  category: string;
  findings: StoredFinding[];
  websiteUrl?: string;
}

export interface EvalResult {
  caseId: string;
  language: Language;
  model: string;
  schemaValid: boolean;
  grounded: boolean;
  generatedBy: 'llm' | 'fallback';
  attempts: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  whatsappChars: number;
  emailWords: number;
  errors: string[];
}

export interface EvalSummary {
  model: string;
  totalCases: number;
  schemaValidRate: number;
  groundedFirstTryRate: number;
  groundedAfterRetryRate: number;
  fallbackRate: number;
  averageLatencyMs: number;
  averageTokensIn: number;
  averageTokensOut: number;
  whatsappWithinLimit: number;
  emailWithinLimit: number;
}

const CASES: EvalCase[] = [
  {
    id: 'slow_site',
    businessName: 'Sharma Plumbing Works',
    category: 'Plumber',
    findings: [
      {
        id: 'SLOW_LCP',
        severity: 'high',
        label: 'Slow to show main content',
        weight: 30,
        evidence: { lcp_ms: 6100, threshold_ms: 4000, unit: 'ms' },
      },
      {
        id: 'NOT_MOBILE_READY',
        severity: 'high',
        label: 'Not usable on a phone',
        weight: 30,
        evidence: { viewportMeta: 'missing', lighthouseViewport: 'passed' },
      },
    ],
    websiteUrl: 'https://sharmaplumbing.in/',
  },
  {
    id: 'no_website',
    businessName: 'Verma Electricals',
    category: 'Electrician',
    findings: [
      {
        id: 'NO_WEBSITE',
        severity: 'high',
        label: 'No website of its own',
        weight: 70,
        evidence: { website: 'none', source: 'google_maps_listing' },
      },
    ],
  },
  {
    id: 'minor_issues',
    businessName: 'Gupta Interiors',
    category: 'Interior designer',
    findings: [
      {
        id: 'MISSING_META_DESCRIPTION',
        severity: 'low',
        label: 'No meta description for search results',
        weight: 8,
        evidence: { present: false },
      },
      {
        id: 'NO_TAP_TO_CALL',
        severity: 'medium',
        label: 'No tap-to-call button',
        weight: 10,
        evidence: { present: false },
      },
    ],
    websiteUrl: 'https://guptainteriors.in/',
  },
];

const LANGUAGES: Language[] = ['en', 'hinglish', 'hi'];

const SENDER = {
  name: 'Aditya',
  portfolioUrl: 'https://aditya.example/',
  services: 'fast, mobile-friendly websites',
};

export interface EvalReport {
  summary: EvalSummary;
  results: EvalResult[];
}

export async function runEval(model: string, baseUrl: string): Promise<EvalReport> {
  const provider = new OllamaProvider({ baseUrl, model, timeoutMs: 120_000 });
  const results: EvalResult[] = [];

  for (const evalCase of CASES) {
    for (const language of LANGUAGES) {
      process.stdout.write(`  ${evalCase.id} / ${language} ... `);
      const result = await runOne(provider, model, evalCase, language);
      process.stdout.write(
        `${result.generatedBy} (${result.attempts} attempt${result.attempts === 1 ? '' : 's'}, ${result.latencyMs} ms, ${result.whatsappChars} chars)\n`,
      );
      results.push(result);
    }
  }

  return { summary: summarise(results), results };
}

async function runOne(
  provider: OllamaProvider,
  model: string,
  evalCase: EvalCase,
  language: Language,
): Promise<EvalResult> {
  const started = Date.now();

  // A raw generation first, to measure the schema rate separately from the
  // orchestrator's retry-and-fallback behaviour.
  let schemaValid: boolean;
  try {
    await provider.generateJson({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({
        businessName: evalCase.businessName,
        category: evalCase.category,
        language,
        findings: evalCase.findings,
        sender: SENDER,
      }),
      schema: draftOutputSchema,
      maxTokens: 600,
      temperature: 0.3,
      signal: new AbortController().signal,
    });
    schemaValid = true;
  } catch {
    schemaValid = false;
  }
  process.stdout.write(`raw schema ok: ${schemaValid ? 'yes' : 'no'}\n`);

  const outcome = await generateDraft(
    {
      businessName: evalCase.businessName,
      category: evalCase.category,
      language,
      findings: evalCase.findings,
      sender: SENDER,
      ...(evalCase.websiteUrl ? { websiteUrl: evalCase.websiteUrl } : {}),
    },
    { provider },
  );

  const validation = validateGrounding(
    {
      whatsapp: outcome.whatsapp,
      email_subject: outcome.email_subject,
      email_body: outcome.email_body,
      used_finding_ids: outcome.used_finding_ids,
    },
    {
      findings: evalCase.findings,
      ...(evalCase.websiteUrl ? { websiteUrl: evalCase.websiteUrl } : {}),
      portfolioUrl: SENDER.portfolioUrl,
    },
  );

  return {
    caseId: evalCase.id,
    language,
    model: model,
    schemaValid,
    grounded: validation.grounded,
    generatedBy: outcome.generated_by,
    attempts: outcome.attempts,
    latencyMs: Date.now() - started,
    tokensIn: outcome.tokens_in,
    tokensOut: outcome.tokens_out,
    whatsappChars: outcome.whatsapp.length,
    emailWords:
      outcome.email_body.trim() === '' ? 0 : outcome.email_body.trim().split(/\s+/).length,
    errors: validation.errors.map((error) => `${error.code}: ${error.message}`),
  };
}

function summarise(results: EvalResult[]): EvalSummary {
  const total = results.length;
  const rate = (count: number): number => (total === 0 ? 0 : Math.round((count / total) * 100));

  const firstTry = results.filter((r) => r.attempts === 1 && r.generatedBy === 'llm').length;
  const afterRetry = results.filter((r) => r.attempts === 2 && r.generatedBy === 'llm').length;
  const fallback = results.filter((r) => r.generatedBy === 'fallback').length;

  const avg = (pick: (r: EvalResult) => number): number =>
    total === 0 ? 0 : Math.round(results.reduce((sum, r) => sum + pick(r), 0) / total);

  return {
    model: results[0]?.model ?? 'unknown',
    totalCases: total,
    schemaValidRate: rate(results.filter((r) => r.schemaValid).length),
    groundedFirstTryRate: rate(firstTry),
    groundedAfterRetryRate: rate(afterRetry),
    fallbackRate: rate(fallback),
    averageLatencyMs: avg((r) => r.latencyMs),
    averageTokensIn: avg((r) => r.tokensIn),
    averageTokensOut: avg((r) => r.tokensOut),
    whatsappWithinLimit: rate(results.filter((r) => r.whatsappChars <= 450).length),
    emailWithinLimit: rate(results.filter((r) => r.emailWords <= 120).length),
  };
}

export function formatMarkdown(summary: EvalSummary, results: EvalResult[]): string {
  const lines = [
    '# Draft evaluation',
    '',
    `Model: \`${summary.model}\``,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Cases | ${summary.totalCases} |`,
    `| Schema-valid rate | ${summary.schemaValidRate}% |`,
    `| Grounded on first try | ${summary.groundedFirstTryRate}% |`,
    `| Grounded after retry | ${summary.groundedAfterRetryRate}% |`,
    `| Fell back to template | ${summary.fallbackRate}% |`,
    `| Average latency | ${summary.averageLatencyMs} ms |`,
    `| Average tokens in | ${summary.averageTokensIn} |`,
    `| Average tokens out | ${summary.averageTokensOut} |`,
    `| WhatsApp within 450 chars | ${summary.whatsappWithinLimit}% |`,
    `| Email within 120 words | ${summary.emailWithinLimit}% |`,
    '',
    '## Per case',
    '',
    '| Case | Language | Schema | Grounded | Source | Attempts | Latency | Chars |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const result of results) {
    lines.push(
      `| ${result.caseId} | ${result.language} | ${result.schemaValid ? 'yes' : 'no'} | ${
        result.grounded ? 'yes' : 'no'
      } | ${result.generatedBy} | ${result.attempts} | ${result.latencyMs} ms | ${result.whatsappChars} |`,
    );
  }

  const failures = results.filter((r) => !r.grounded);
  if (failures.length > 0) {
    lines.push('', '## Validation failures', '');
    for (const failure of failures) {
      lines.push(`- **${failure.caseId} / ${failure.language}**: ${failure.errors.join('; ')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** Write the report where the release tooling expects it. */
export function writeReport(summary: EvalSummary, results: EvalResult[], outDir: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const path = `${outDir}/${stamp}.md`;
  writeFileSync(path, formatMarkdown(summary, results), 'utf8');
  return path;
}

export { CASES, LANGUAGES, SENDER };
