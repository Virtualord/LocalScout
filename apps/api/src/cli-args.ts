import type { Language } from '@localscout/core';

/**
 * CLI argument parsing.
 *
 * Extracted from `cli.ts` and kept pure so it can be tested without starting a
 * process. A typo here quietly runs the wrong search against a paid API key, so
 * every rejection names the accepted values.
 */

export interface CliArgs {
  query: string;
  location: string;
  limit: number;
  language: Language;
}

/** Thrown for bad input. `cli.ts` turns this into a message and an exit code. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export const CLI_USAGE =
  'Usage: pnpm cli "plumbers" Bhopal [--limit 20] [--language en|hinglish|hi]';

const LANGUAGES: readonly Language[] = ['en', 'hinglish', 'hi'];

export function parseCliArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;

    if (token.startsWith('--')) {
      const [key, inlineValue] = token.slice(2).split('=');
      if (key === undefined) continue;
      const value = inlineValue ?? argv[++i];
      if (value !== undefined) flags.set(key, value);
      continue;
    }

    positional.push(token);
  }

  const query = flags.get('query') ?? positional[0];
  const location = flags.get('location') ?? positional[1];

  if (!query || !location) {
    throw new CliUsageError(`A business type and a city are required. ${CLI_USAGE}`);
  }

  const limitRaw = flags.get('limit') ?? '20';
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new CliUsageError(`--limit must be a whole number between 1 and 50 (got "${limitRaw}").`);
  }

  const languageRaw = flags.get('language') ?? 'en';
  if (!LANGUAGES.includes(languageRaw as Language)) {
    throw new CliUsageError(
      `--language must be en, hinglish or hi (got "${languageRaw}"). ${CLI_USAGE}`,
    );
  }

  return { query, location, limit, language: languageRaw as Language };
}
