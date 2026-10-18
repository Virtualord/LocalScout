import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import {
  FixtureProvider,
  loadConfig,
  OllamaProvider,
  OpenAiCompatibleProvider,
  openDb,
  runMigrations,
  createLogger,
  createRepositories,
  type AppConfig,
  type Db,
  type LlmProvider,
  type Emit,
  type PipelineDeps,
  type Repositories,
  type SenderProfile,
} from '@localscout/core';
import { resolveWebDist } from './web.js';

/**
 * Application wiring.
 *
 * One place that turns environment variables into the objects every entry point
 * needs: the API server, the CLI, and the workflow. Keeping it here is what lets
 * the CLI and the server share behaviour instead of drifting apart, and it means
 * a config error surfaces identically in both.
 */

/** Git-ignored: it holds one person's name and portfolio URL. */
const SENDER_FILE = 'config/sender.local.json';

export interface AppRuntime {
  config: AppConfig;
  db: Db;
  repos: Repositories;
  logger: Logger;
  provider: LlmProvider;
  sender: SenderProfile;
  /** Absolute path to the SQLite file. */
  databaseUrl: string;
  /** Absolute path to the directory holding Lighthouse reports. */
  reportDir: string;
  /** Absolute path to the web build to serve, when SERVE_WEB is on. */
  webDist: string | undefined;
  close(): void;
}

/** Build the LLM provider named by the configuration. */
export function createProvider(config: AppConfig): LlmProvider {
  switch (config.llm.provider) {
    case 'ollama':
      return new OllamaProvider({
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        timeoutMs: config.llm.timeoutMs,
      });
    case 'openai-compatible':
      return new OpenAiCompatibleProvider({
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        apiKey: config.llm.apiKey,
        timeoutMs: config.llm.timeoutMs,
      });
    case 'fixture':
      return new FixtureProvider();
  }
}

/**
 * Read the sender profile.
 *
 * `config/sender.local.json` wins over the environment, so the Settings screen
 * can save a profile without the user editing `.env`. The file is git-ignored
 * because it contains one person's name and portfolio.
 */
export function loadSenderProfile(config: AppConfig): SenderProfile {
  const base: SenderProfile = {
    name: config.sender.name ?? '',
    services: config.sender.services,
    ...(config.sender.portfolioUrl ? { portfolioUrl: config.sender.portfolioUrl } : {}),
  };

  try {
    // Synchronous at boot by design: this runs once, before any request, and the
    // profile is needed to build the very first draft.
    const parsed = JSON.parse(readFileSync(SENDER_FILE, 'utf8')) as Partial<SenderProfile>;
    const portfolioUrl = parsed.portfolioUrl ?? base.portfolioUrl;
    return {
      name: parsed.name ?? base.name,
      services: parsed.services ?? base.services,
      ...(portfolioUrl !== undefined ? { portfolioUrl } : {}),
    };
  } catch {
    // No file, or unreadable. The environment value is the fallback, which is
    // exactly what a first run should do.
    return base;
  }
}

export interface BootOptions {
  /** Override the database path, used by tests. */
  databaseUrl?: string;
  /** Pretty logs for a terminal. */
  prettyLogs?: boolean;
  /** Skip migrations, when the caller already applied them. */
  skipMigrations?: boolean;
  /** Skip reading `.env`, when the caller supplied its own environment. */
  skipEnvFile?: boolean;
}

/**
 * The `.env` file, if there is one.
 *
 * Every instruction this project gives about configuration says "put the key in
 * `.env`" — the README, the settings screen, the health check's own advice and
 * `MANUAL_STEPS.md` — and until now nothing read the file. A user who followed
 * those instructions exactly would fill in the key, restart, and be told they had
 * no key, with nothing in the logs to say why. So it is read here, in the one
 * function every entry point goes through.
 *
 * Node's own `process.loadEnvFile`, not a dependency: it is the same parser the
 * `--env-file` flag uses, so there is one definition of what the file means
 * rather than two that disagree on quoting. It does not overwrite variables
 * already in the environment, which is what makes `SERPAPI_API_KEY=... pnpm dev`
 * still work and keeps a CI-injected value authoritative.
 *
 * A missing file is the normal case and is not an error: the app is built to run
 * with no keys at all. A file that exists but cannot be parsed *is* an error,
 * because silently ignoring it means a typo in the one line the user cares about
 * costs them a debugging session.
 */
function loadEnvFile(envFile: string): void {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw new Error(
      `Could not read ${envFile}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Where the file is, which is not the working directory.
 *
 * `pnpm dev` starts the API from `apps/api`, so `.` is `apps/api` and the `.env`
 * at the repository root — the file `.env.example` sits beside, and the one every
 * instruction in this project names — would never be found. Walking up from the
 * module's own directory rather than from `process.cwd()` also means it is found
 * whichever package directory the command was launched from, and it stops at the
 * repository root instead of reading a `.env` belonging to something further up
 * the filesystem.
 */
function resolveEnvFile(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Nothing found: return the repo-root path anyway so the ENOENT branch above
  // treats it as "no keys", which is the normal case and not an error.
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env');
}

export function boot(env: NodeJS.ProcessEnv = process.env, options: BootOptions = {}): AppRuntime {
  /*
   * Read `.env` before anything reads the environment, so every later line in
   * this function sees the values the user wrote. Skipped when the caller passes
   * its own environment object — the tests do, and they have no file to read.
   */
  if (options.skipEnvFile !== true && env === process.env) {
    loadEnvFile(resolveEnvFile());
  }

  /*
   * A configuration error is thrown, not printed and exited on.
   *
   * `boot` is called by the API, the CLI and the tests, and a function that ends
   * the process makes that decision on behalf of all three: the test runner
   * cannot assert the message, and the CLI cannot decide how to render it. Each
   * entry point prints it its own way without a stack trace —
   * `describeStartupError` for the API, `cli.ts` for the command line.
   */
  const config = loadConfig(env);

  const databaseUrl = options.databaseUrl ?? join(config.app.dataDir, 'localscout.db');

  if (options.skipMigrations !== true) {
    runMigrations({ url: databaseUrl });
  }

  const db = openDb({ url: databaseUrl });
  const repos = createRepositories(db);

  const logger = createLogger({
    level: config.app.logLevel,
    ...(options.prettyLogs ? { pretty: true } : {}),
  });

  const provider = createProvider(config);
  const sender = loadSenderProfile(config);

  return {
    config,
    db,
    repos,
    logger,
    provider,
    sender,
    databaseUrl,
    reportDir: join(config.app.dataDir, 'reports'),
    webDist: resolveWebDist(config),
    close: () => db.close(),
  };
}

/**
 * Assemble the dependency bundle the pipeline expects.
 *
 * `signal` is the run's cancellation switch, so a cancel reaches the work that
 * is actually running rather than only the row that describes it.
 */
export function pipelineDeps(runtime: AppRuntime, emit: Emit, signal?: AbortSignal): PipelineDeps {
  return {
    config: runtime.config,
    repos: runtime.repos,
    logger: runtime.logger,
    emit,
    provider: runtime.provider,
    sender: runtime.sender,
    ...(signal !== undefined ? { signal } : {}),
  };
}
