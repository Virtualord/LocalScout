import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 *
 * The defaults are chosen so `pnpm dev` works with no `.env` at all: fixtures
 * discovery, the fixture LLM provider, and no external dependency. Anything
 * that needs a key is optional at the schema level and validated by a
 * cross-field rule below, so "you are in live mode but have no key" fails with
 * a message that says exactly that.
 */

/** Empty string means "not set" for every optional string. */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const optionalPort = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : Number(v)));

export const discoveryModeSchema = z.enum(['fixtures', 'live']);
export const llmProviderSchema = z.enum(['fixture', 'ollama', 'openai-compatible']);
export const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);
export const languageSchema = z.enum(['en', 'hinglish', 'hi']);

const rawEnvSchema = z.object({
  // Discovery
  DISCOVERY_MODE: z.enum(['fixtures', 'live']).default('fixtures'),
  SERPAPI_API_KEY: optionalString,
  SERPAPI_CACHE_DIR: z.string().default('./data/cache/serpapi'),

  // LLM
  LLM_PROVIDER: z.enum(['fixture', 'ollama', 'openai-compatible']).default('fixture'),
  LLM_BASE_URL: z.string().default('http://127.0.0.1:11434'),
  LLM_MODEL: z.string().default('gemma3:4b'),
  LLM_API_KEY: optionalString,
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // Audit
  CHROME_PATH: optionalString,
  AUDIT_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  AUDIT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // App
  DEFAULT_COUNTRY: z.string().length(2).default('IN'),
  DATA_DIR: z.string().default('./data'),
  API_PORT: optionalPort.pipe(z.number().int().min(1).max(65_535).default(8787)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Sender profile (env fallback; the Settings screen writes config/sender.local.json)
  SENDER_NAME: optionalString,
  SENDER_PORTFOLIO_URL: optionalString,
  SENDER_SERVICES: z.string().default('website redesign, mobile-friendly sites, speed fixes'),

  // Optional scheduled saved searches, off by default.
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type RawEnv = z.infer<typeof rawEnvSchema>;

export interface AppConfig {
  discovery: {
    mode: 'fixtures' | 'live';
    serpApiKey: string | undefined;
    cacheDir: string;
  };
  llm: {
    provider: 'fixture' | 'ollama' | 'openai-compatible';
    baseUrl: string;
    model: string;
    apiKey: string | undefined;
    timeoutMs: number;
  };
  audit: {
    chromePath: string | undefined;
    concurrency: number;
    timeoutMs: number;
  };
  app: {
    defaultCountry: string;
    dataDir: string;
    apiPort: number;
    logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  };
  sender: {
    name: string | undefined;
    portfolioUrl: string | undefined;
    services: string;
  };
  scheduler: { enabled: boolean };
}

export class ConfigError extends Error {
  readonly issues: { path: string; message: string }[];

  constructor(message: string, issues: { path: string; message: string }[]) {
    super(message);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Render a zod error as a list a person can act on.
 *
 * Zod's default message names the issue but not the environment variable, and
 * this app fails at startup on a fresh clone, so the variable name matters.
 */
function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/**
 * Cross-field rules that a per-field schema cannot express.
 *
 * These are the failures a first-time user actually hits, so each one names the
 * variable to set and the command that fixes it.
 */
function checkCrossFieldRules(env: RawEnv): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];

  if (env.DISCOVERY_MODE === 'live' && !env.SERPAPI_API_KEY) {
    issues.push({
      path: 'SERPAPI_API_KEY',
      message:
        'DISCOVERY_MODE=live needs a SerpApi key. Put SERPAPI_API_KEY in .env, or set DISCOVERY_MODE=fixtures to use recorded data.',
    });
  }

  if (env.LLM_PROVIDER === 'openai-compatible' && !env.LLM_API_KEY) {
    issues.push({
      path: 'LLM_API_KEY',
      message:
        'LLM_PROVIDER=openai-compatible needs LLM_API_KEY unless your endpoint is unauthenticated. Set it, or use LLM_PROVIDER=ollama.',
    });
  }

  if (env.LLM_PROVIDER === 'ollama' && !/^https?:\/\//.test(env.LLM_BASE_URL)) {
    issues.push({
      path: 'LLM_BASE_URL',
      message: `LLM_BASE_URL must start with http:// or https:// (got "${env.LLM_BASE_URL}").`,
    });
  }

  if (env.SENDER_PORTFOLIO_URL && !/^https?:\/\//.test(env.SENDER_PORTFOLIO_URL)) {
    issues.push({
      path: 'SENDER_PORTFOLIO_URL',
      message: `SENDER_PORTFOLIO_URL must start with http:// or https:// (got "${env.SENDER_PORTFOLIO_URL}").`,
    });
  }

  return issues;
}

/**
 * Parse and validate an environment.
 *
 * Throws {@link ConfigError} with a ready-to-print message rather than letting
 * a bad value surface later as a confusing runtime failure.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawEnvSchema.safeParse(env);

  if (!parsed.success) {
    const issues = formatIssues(parsed.error);
    throw new ConfigError(
      `Invalid environment configuration:\n${issues
        .map((i) => `  - ${i.path}: ${i.message}`)
        .join('\n')}\n\nCopy .env.example to .env and fix the values above.`,
      issues,
    );
  }

  const crossIssues = checkCrossFieldRules(parsed.data);
  if (crossIssues.length > 0) {
    throw new ConfigError(
      `Invalid environment configuration:\n${crossIssues
        .map((i) => `  - ${i.path}: ${i.message}`)
        .join('\n')}\n\nCopy .env.example to .env and fix the values above.`,
      crossIssues,
    );
  }

  const data = parsed.data;

  return {
    discovery: {
      mode: data.DISCOVERY_MODE,
      serpApiKey: data.SERPAPI_API_KEY,
      cacheDir: data.SERPAPI_CACHE_DIR,
    },
    llm: {
      provider: data.LLM_PROVIDER,
      baseUrl: data.LLM_BASE_URL,
      model: data.LLM_MODEL,
      apiKey: data.LLM_API_KEY,
      timeoutMs: data.LLM_TIMEOUT_MS,
    },
    audit: {
      chromePath: data.CHROME_PATH,
      concurrency: data.AUDIT_CONCURRENCY,
      timeoutMs: data.AUDIT_TIMEOUT_MS,
    },
    app: {
      defaultCountry: data.DEFAULT_COUNTRY.toUpperCase(),
      dataDir: data.DATA_DIR,
      apiPort: data.API_PORT,
      logLevel: data.LOG_LEVEL,
    },
    sender: {
      name: data.SENDER_NAME,
      portfolioUrl: data.SENDER_PORTFOLIO_URL,
      services: data.SENDER_SERVICES,
    },
    scheduler: { enabled: data.SCHEDULER_ENABLED },
  };
}

export { rawEnvSchema };
