/**
 * `pnpm eval`
 *
 * Runs the draft evaluation against every model in EVAL_MODELS and writes one
 * markdown report per model into eval/results/.
 *
 * This needs a reachable Ollama, so it is not part of `pnpm test`: CI has no
 * model on disk. The numbers it produces are evidence for the write-up rather
 * than a pass/fail gate, which is why it reports rather than exits non-zero on
 * a low grounding rate.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMarkdown, OllamaProvider, runEval, type EvalReport } from '@localscout/core';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'eval', 'results');

const baseUrl = process.env['LLM_BASE_URL'] ?? 'http://127.0.0.1:11434';
const models = (process.env['EVAL_MODELS'] ?? process.env['LLM_MODEL'] ?? 'gemma3:4b')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  // Fail early and loudly when there is nothing to talk to, rather than
  // producing nine empty rows and a report that reads like a result.
  const probeModel = models[0];
  if (!probeModel) {
    process.stderr.write(
      'No models to evaluate. Set EVAL_MODELS, for example EVAL_MODELS=gemma3:4b\n',
    );
    process.exitCode = 1;
    return;
  }

  const status = await new OllamaProvider({
    baseUrl,
    model: probeModel,
    timeoutMs: 10_000,
  }).health();
  if (!status.reachable) {
    process.stderr.write(`${status.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Ollama reachable at ${baseUrl}\n`);

  const reports: EvalReport[] = [];

  for (const model of models) {
    process.stdout.write(`\n=== ${model} ===\n`);
    reports.push(await runEval(model, baseUrl));
  }

  const sections = reports.map((report) => formatMarkdown(report.summary, report.results));
  const stamp = new Date().toISOString().slice(0, 10);
  const file = join(outDir, `${stamp}.md`);
  writeFileSync(file, sections.join('\n---\n\n'), 'utf8');

  process.stdout.write(`\nWrote ${file}\n`);

  for (const report of reports) {
    const { summary } = report;
    process.stdout.write(
      `${summary.model}: schema ${summary.schemaValidRate}%, first-try grounded ${summary.groundedFirstTryRate}%, fallback ${summary.fallbackRate}%, avg ${summary.averageLatencyMs} ms\n`,
    );
  }
}

await main();
