import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, unavailable, type SourceResult } from '../result/source-result.js';
import { normalizeSerpApiResponse, type Listing, type SerpApiResponse } from './normalize.js';

/**
 * Recorded-response discovery.
 *
 * Fixtures mode is what makes the quickstart work: `pnpm dev` finds leads with
 * no API key and no network. It also gives the audit and draft code a
 * realistic SerpApi response to run against in tests.
 *
 * A query that does not match a recorded city falls back to the city whose name
 * is closest, and says so through `stale`, rather than silently returning
 * nothing. Someone typing "plumbers in Bhopal" on a fresh clone should get
 * plausible leads to look at.
 */

export interface FixturesOptions {
  /** Directory holding `google_maps_*.json`. Defaults to the repo `fixtures/serpapi`. */
  dir?: string;
  defaultCountry: string;
}

export interface FixturesOutcome {
  listings: Listing[];
  /** Which recorded file answered. */
  fixture: string;
  /** True when the requested city was matched by a recorded file. */
  exactMatch: boolean;
}

function defaultFixturesDir(): string {
  // packages/core/src/discovery -> packages/core -> packages -> repo root
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'fixtures',
    'serpapi',
  );
}

export async function searchFixtures(
  options: FixturesOptions,
  query: string,
  location: string,
): Promise<SourceResult<FixturesOutcome>> {
  const started = Date.now();
  const dir = options.dir ?? defaultFixturesDir();

  const files = await listFixtureFiles(dir);
  if (files.length === 0) {
    return unavailable(
      'discovery',
      {
        code: 'fixtures_missing',
        message: `No recorded responses in ${dir}. Run "pnpm --filter @localscout/core fixtures:generate", or set DISCOVERY_MODE=live with a SerpApi key.`,
      },
      Date.now() - started,
    );
  }

  const match = matchCity(location, files);

  const file = match.city === null ? undefined : match.file;
  if (!file) {
    return unavailable(
      'discovery',
      {
        code: 'fixtures_no_match',
        message: `No recorded data for "${location}". Recorded cities: ${files.map((f) => f.city).join(', ')}.`,
      },
      Date.now() - started,
    );
  }

  const response = await readResponse(join(dir, file));
  if (!response) {
    return unavailable(
      'discovery',
      {
        code: 'fixtures_unreadable',
        message: `Recorded response ${file} could not be read. Re-run "pnpm --filter @localscout/core fixtures:generate".`,
      },
      Date.now() - started,
    );
  }

  const all = normalizeSerpApiResponse(response, options.defaultCountry);
  // A recorded city holds a mix of trades, so a query still narrows the set:
  // matches on the category word, with everything kept when nothing matches.
  const narrowed = narrowByQuery(all, query);

  const outcome: FixturesOutcome = {
    listings: narrowed,
    fixture: file,
    exactMatch: match.exact,
  };

  if (!match.exact) {
    return {
      status: 'stale',
      kind: 'discovery',
      value: outcome,
      meta: {
        durationMs: Date.now() - started,
        at: new Date().toISOString(),
        fromCache: true,
        degradedBy: ['fixtures_nearest_city'],
      },
      error: {
        code: 'fixtures_nearest_city',
        message: `No recorded data for "${location}". Showing "${match.city}" instead.`,
      },
    };
  }

  return ok('discovery', outcome, Date.now() - started, true);
}

interface FixtureFile {
  city: string;
  file: string;
}

interface CityMatch {
  city: string | null;
  file: string | undefined;
  exact: boolean;
}

/**
 * Find the recorded city for a requested location.
 *
 * Falls back to the city sharing the longest leading substring, so "Bhopal,
 * Madhya Pradesh" still finds `bhopal`. Returns a null city when nothing is
 * close, which the caller reports rather than silently returning no leads.
 */
function matchCity(location: string, files: FixtureFile[]): CityMatch {
  const needle = location.trim().toLowerCase();
  if (needle === '') return { city: null, file: undefined, exact: false };

  const exact = files.find((file) => file.city === needle);
  if (exact) return { city: exact.city, file: exact.file, exact: true };

  let best: FixtureFile | undefined;
  let bestLength = 0;
  for (const file of files) {
    if (needle.includes(file.city) && file.city.length > bestLength) {
      best = file;
      bestLength = file.city.length;
    }
  }

  return best
    ? { city: best.city, file: best.file, exact: false }
    : { city: null, file: undefined, exact: false };
}

async function listFixtureFiles(dir: string): Promise<FixtureFile[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((name) => name.startsWith('google_maps_') && name.endsWith('.json'))
      .map((name) => ({
        city: name.replace(/^google_maps_/, '').replace(/\.json$/, ''),
        file: name,
      }));
  } catch {
    return [];
  }
}

async function readResponse(file: string): Promise<SerpApiResponse | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as SerpApiResponse;
  } catch {
    return undefined;
  }
}

/**
 * Narrow recorded places to a query.
 *
 * Recorded files hold several trades per city. Matching the query against the
 * title and category keeps the demo focused on what was asked for, and returns
 * the full set when the query matches nothing, since an empty demo teaches a
 * first-time user nothing.
 */
export function narrowByQuery(listings: Listing[], query: string): Listing[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return listings;

  const terms = needle.split(/\s+/).filter((term) => term.length > 2);
  if (terms.length === 0) return listings;

  const matched = listings.filter((listing) => {
    const haystack = `${listing.name} ${listing.category ?? ''}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });

  return matched.length > 0 ? matched : listings;
}
