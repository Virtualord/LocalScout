import { useQuery } from '@tanstack/react-query';
import { InteriorHero } from '../../components/sections.js';
import { Card, ComparisonRow } from '../../design/card.js';
import { Chip } from '../../design/chip.js';
import { Accordion, AccordionItem } from '../../design/primitives.js';
import { api } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';

/**
 * Settings and health.
 *
 * Shows what the running instance actually has, read from `/api/health`, and
 * what each missing key would change. The point is that nothing here is
 * required: the app is designed to run in fixtures mode with no keys, no
 * Chrome and no model, so this page mostly reports what is absent and what
 * that means.
 *
 * Configuration is not editable in the browser. Keys go in a local `.env` that
 * never leaves the machine, and a settings form that posts secrets to an HTTP
 * endpoint would undo the entire local-first premise.
 */

export function SettingsScreen() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
  });

  return (
    <div>
      <InteriorHero
        titleA="What this machine"
        titleB="actually has."
        subline="Read live from the API. Nothing here is configured from the browser."
        accent="amber"
      />

      <div className="container py-12">
        {isPending && <p className="text-[15px] text-ink/70">Checking the API…</p>}

        {isError && (
          <div className="border-l-4 border-red bg-red/5 px-5 py-4">
            <p className="display text-lg text-red">The API is not answering.</p>
            <p className="mt-1 text-[14px] text-ink/75">
              {error instanceof Error ? error.message : 'No response from port 8787.'}
            </p>
            <p className="mt-2 text-[13px] text-ink/65">
              Start both halves with <code className="mono">pnpm dev</code>.
            </p>
          </div>
        )}

        {data !== undefined && (
          <div className="space-y-14">
            <section aria-labelledby="modes-heading">
              <h2 id="modes-heading" className="display display-section text-ink">
                Active modes
              </h2>
              <Card className="mt-6 p-0">
                <ComparisonRow label="Discovery" value={describeMode(data.modes.discovery)} />
                <ComparisonRow label="Language model" value={describeMode(data.modes.llm)} />
                <ComparisonRow
                  label="SerpApi key"
                  value={data.keys.serpApi ? 'present' : 'absent — using fixtures'}
                />
                <ComparisonRow
                  label="Model key"
                  value={data.keys.llm ? 'present' : 'absent — using templates'}
                />
              </Card>
              <p className="mono mt-4 text-[12px] text-ink/60">
                Overall: {data.ok ? 'ready' : 'degraded, see the checks below'}
              </p>
            </section>

            <section aria-labelledby="checks-heading">
              <h2 id="checks-heading" className="display display-section text-ink">
                Checks
              </h2>
              <ul className="mt-6 space-y-3">
                {data.checks.map((check) => (
                  <li key={check.name}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <p className="mono text-[12px] font-bold uppercase tracking-wider text-ink">
                          {check.name}
                        </p>
                        <p className="mt-1 text-[14px] text-ink/75">{check.detail}</p>
                        {!check.ok && check.fix !== undefined && (
                          <p className="mt-1.5 text-[13px] text-ink/60">{check.fix}</p>
                        )}
                      </div>
                      <Chip variant={check.ok ? 'status-won' : 'severity-medium'}>
                        {check.ok ? 'ok' : 'degraded'}
                      </Chip>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="config-heading">
              <h2 id="config-heading" className="display display-section text-ink">
                Configuration
              </h2>
              <p className="prose-measure mt-3 text-[15px] leading-relaxed text-ink/70">
                Everything is read from a <code className="mono">.env</code> file in the repository
                root. There is no settings form, deliberately: a form that posts a key to an HTTP
                endpoint on localhost would put the one secret this project has behind a browser
                instead of behind a file.
              </p>

              <Accordion type="single" collapsible className="mt-6 border-t border-ink/15">
                {ENV_VARS.map((variable) => (
                  <AccordionItem key={variable.name} value={variable.name} question={variable.name}>
                    <p className="mono text-[12px] text-ink/60">{variable.purpose}</p>
                    <p className="mt-2 text-[14px] text-ink/80">{variable.effect}</p>
                    <p className="mt-2 text-[13px] text-ink/60">
                      Default: <code className="mono">{variable.fallback}</code>
                    </p>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>

            <section aria-labelledby="privacy-heading">
              <h2 id="privacy-heading" className="display display-section text-ink">
                What leaves this machine
              </h2>
              <ul className="mt-6 space-y-4">
                {EXFILTRATION.map((item) => (
                  <li key={item.what} className="border-l-4 border-ink/20 pl-4">
                    <p className="text-[15px] font-medium text-ink">{item.what}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink/75">{item.detail}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-l-4 border-coral bg-coral/10 px-4 py-3 text-[14px] leading-relaxed text-ink/85">
                Page text scraped from a business&rsquo;s site is never sent to the model. Only the
                structured findings are: an id, a label, a measured value and the threshold it
                failed. That is what makes it impossible for the draft to describe something the
                audit did not measure.
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Turn a mode slug into something a person can act on. */
export function describeMode(mode: string): string {
  const descriptions: Record<string, string> = {
    live: 'SerpApi — live results',
    fixtures: 'Fixtures — the bundled listings, no key needed',
    ollama: 'Ollama — a local model',
    'openai-compatible': 'OpenAI-compatible endpoint',
    fixture: 'Templates — no model, guaranteed grounded',
  };
  return descriptions[mode] ?? mode;
}

const ENV_VARS = [
  {
    name: 'SERPAPI_API_KEY',
    purpose: 'Live business discovery.',
    effect:
      'Without it, discovery serves the bundled fixture listings for three cities. That is enough to walk the whole pipeline end to end, and the leads are clearly marked as fixtures in the run log.',
    fallback: 'unset — fixtures mode',
  },
  {
    name: 'OLLAMA_HOST',
    purpose: 'Where the local model lives.',
    effect:
      'Ollama serves one request at a time, which is why drafts are written sequentially while audits run in parallel. A faster machine would not change that unless Ollama itself got faster.',
    fallback: 'http://127.0.0.1:11434',
  },
  {
    name: 'OLLAMA_MODEL',
    purpose: 'Which local model to use.',
    effect:
      'Any Ollama chat model works. Small models are the ones that get grounded wrong most often, so a 4b model falls back to the template more than a 12b one.',
    fallback: 'gemma3:4b',
  },
  {
    name: 'CHROME_PATH',
    purpose: 'Where Chrome is, for the Lighthouse metrics.',
    effect:
      'If Chrome is not found, audits still run and still check the page structure, but the timing metrics are recorded as absent and the audit is labelled stale. No metric is ever invented.',
    fallback: 'auto-detected',
  },
  {
    name: 'AUDIT_CONCURRENCY',
    purpose: 'How many sites are audited at once.',
    effect:
      "Audits are network-bound, so a higher number finishes sooner. The default is deliberately low so a run does not look like an attack on a small business's server.",
    fallback: '3',
  },
  {
    name: 'DATA_DIR',
    purpose: 'Where the SQLite database lives.',
    effect: 'Delete this directory to start completely fresh. Nothing else is stored anywhere.',
    fallback: './data',
  },
] as const;

const EXFILTRATION = [
  {
    what: 'Your search terms and city, to SerpApi',
    detail: 'Only when a key is configured. Without one, no search leaves the machine.',
  },
  {
    what: "Each business's own URL, to that site",
    detail:
      'Once per lead, on a fresh connection, with the SSRF guard checking every resolved address and every redirect hop first.',
  },
  {
    what: 'Structured findings, to your local model',
    detail:
      'Finding ids, labels and measured numbers. Never raw page text. Ollama is on localhost; nothing is sent to a hosted model unless OLLAMA_HOST is pointed at one deliberately.',
  },
  {
    what: 'Messages, to nowhere',
    detail:
      'There is no send path. Drafts go to the clipboard, and the only thing this app records about outreach is what you tell it you did.',
  },
] as const;
