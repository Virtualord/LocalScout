import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ok, stale, type SourceResult } from '../result/source-result.js';
import type { SerpApiResponse } from './normalize.js';

/**
 * SerpApi Google Maps client with a disk cache.
 *
 * The cache is not an optimisation detail, it is a quota protection and a
 * reproducibility tool:
 *
 * - Every distinct request costs money against a limited free tier. Re-running a
 *   search should not spend anything.
 * - A recorded response makes a run replayable, which is what lets the audit
 *   and draft code be tested against a real API shape without a key.
 *
 * Cache entries are written under a hash of the request, so the same query in
 * the same city always reads the same file.
 */

export interface SerpApiClientOptions {
  apiKey: string;
  cacheDir: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to 20 seconds. */
  timeoutMs?: number;
}

export interface SearchRequest {
  /** Business type, for example "plumbers". */
  query: string;
  /** City, for example "Bhopal". */
  location: string;
  country: string;
  limit?: number;
  language?: string;
}

export interface SearchOutcome {
  response: SerpApiResponse;
  /** True when the payload came from disk rather than the network. */
  fromCache: boolean;
  /** How the payload was obtained, for the metrics endpoint. */
  cacheStatus: 'hit' | 'miss' | 'bypass';
  requestUrl: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Build the SerpApi request URL for a Google Maps search. */
export function buildSearchUrl(request: SearchRequest, apiKey: string): string {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_maps');
  url.searchParams.set('type', 'search');
  url.searchParams.set('q', `${request.query} in ${request.location}`);
  url.searchParams.set('ll', request.location);
  url.searchParams.set('gl', request.country.toLowerCase());
  url.searchParams.set('hl', 'en');
  url.searchParams.set('api_key', apiKey);
  return url.toString();
}

/**
 * A stable cache key for a request.
 *
 * The API key is deliberately excluded: rotating a key must not invalidate a
 * cached response, and a key must never reach a filename.
 */
export function cacheKeyFor(request: SearchRequest): string {
  const canonical = JSON.stringify({
    q: request.query.trim().toLowerCase(),
    ll: request.location.trim().toLowerCase(),
    gl: request.country.trim().toLowerCase(),
    hl: request.language ?? 'en',
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function cacheFileFor(cacheDir: string, key: string): string {
  return join(cacheDir, `${key}.json`);
}

/**
 * Run a Google Maps search, preferring a cached response.
 *
 * Returns `stale` rather than failing when a cached copy exists but is
 * unreadable, because a corrupt cache entry should not stop a search that can
 * still be served from the network.
 */
export async function searchGoogleMaps(
  options: SerpApiClientOptions,
  request: SearchRequest,
): Promise<SourceResult<SearchOutcome>> {
  const started = Date.now();
  const key = cacheKeyFor(request);
  const file = cacheFileFor(options.cacheDir, key);
  const requestUrl = buildSearchUrl(request, options.apiKey);

  const cached = await readCache(file);
  if (cached) {
    return ok(
      'discovery',
      { response: cached, fromCache: true, cacheStatus: 'hit', requestUrl },
      Date.now() - started,
      true,
    );
  }

  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(requestUrl, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      return stale(
        'discovery',
        { response: { local_results: [] }, fromCache: false, cacheStatus: 'miss', requestUrl },
        {
          code: 'serpapi_http_error',
          message: `SerpApi returned ${response.status}. Check that SERPAPI_API_KEY is valid and the account has remaining searches.`,
        },
        Date.now() - started,
        ['serpapi'],
      );
    }

    const payload = (await response.json()) as SerpApiResponse;

    // SerpApi reports per-request problems in a 200 body.
    const status = payload.search_metadata?.status;
    if (status !== undefined && status !== 'Success') {
      return stale(
        'discovery',
        { response: payload, fromCache: false, cacheStatus: 'miss', requestUrl },
        {
          code: 'serpapi_error',
          message: `SerpApi reported "${status}". Check the API key and search quota.`,
        },
        Date.now() - started,
        ['serpapi'],
      );
    }

    await writeCache(file, payload);

    return ok(
      'discovery',
      { response: payload, fromCache: false, cacheStatus: 'miss', requestUrl },
      Date.now() - started,
    );
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return stale(
      'discovery',
      { response: { local_results: [] }, fromCache: false, cacheStatus: 'miss', requestUrl },
      {
        code: isTimeout ? 'serpapi_timeout' : 'serpapi_unreachable',
        message: isTimeout
          ? `SerpApi did not respond within ${timeoutMs}ms. Retry, or set DISCOVERY_MODE=fixtures to use recorded data.`
          : 'SerpApi could not be reached. Check the network, or set DISCOVERY_MODE=fixtures to use recorded data.',
        durationMs: Date.now() - started,
      },
      Date.now() - started,
      ['serpapi'],
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a cached response.
 *
 * A missing file is a miss. An unreadable or malformed file is also treated as
 * a miss, and removed so the next run does not keep retrying it.
 */
async function readCache(file: string): Promise<SerpApiResponse | undefined> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as SerpApiResponse;
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;

    // Corrupt cache entry: drop it so the next run starts clean.
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(file);
    } catch {
      // Best effort; a cache that cannot be deleted is overwritten on write.
    }
    return undefined;
  }
}

async function writeCache(file: string, payload: SerpApiResponse): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // A cache that cannot be written must not fail the search. The next run
    // simply pays for another API call.
  }
}
