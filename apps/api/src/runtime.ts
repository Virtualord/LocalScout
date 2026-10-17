import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
}

export function boot(env: NodeJS.ProcessEnv = process.env, options: BootOptions = {}): AppRuntime {
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
