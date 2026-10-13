import type { LeadRepository } from '../db/repositories/leads.repository.js';
import { ok, stale, type SourceResult } from '../result/source-result.js';
import { computeDomainKey } from './domain-key.js';
import { searchFixtures, type FixturesOptions } from './fixtures.js';
import type { Listing } from './normalize.js';
import { normalizeSerpApiResponse } from './normalize.js';
import { searchGoogleMaps, type SearchRequest } from './serpapi.client.js';

/**
 * Discovery.
 *
 * One entry point for both modes. `discover()` picks the implementation from
 * config and returns the same shape either way, so the workflow never branches
 * on whether a key happens to be present.
 */

export interface DiscoverOptions {
  mode: 'fixtures' | 'live';
  query: string;
  location: string;
  country: string;
  limit: number;
  /** Live mode only. */
  serpApiKey?: string | undefined;
  cacheDir?: string | undefined;
  /** Fixtures mode only. */
  fixturesDir?: string | undefined;
  fetchImpl?: typeof fetch;
}

export interface DiscoveryOutcome {
  listings: Listing[];
  /** How the results were obtained, for the run log and metrics. */
  source: 'fixtures' | 'serpapi-cache' | 'serpapi';
  /** True when at least one SerpApi call was paid for. */
  serpApiCalls: number;
  /** True when the answer is partial. */
  degraded: boolean;
}

export async function discover(options: DiscoverOptions): Promise<SourceResult<DiscoveryOutcome>> {
  if (options.mode === 'fixtures') {
    return discoverFromFixtures(options);
  }
  return discoverFromSerpApi(options);
}

async function discoverFromFixtures(
  options: DiscoverOptions,
): Promise<SourceResult<DiscoveryOutcome>> {
  const fixtureOptions: FixturesOptions = {
    defaultCountry: options.country,
    ...(options.fixturesDir ? { dir: options.fixturesDir } : {}),
  };

  const result = await searchFixtures(fixtureOptions, options.query, options.location);
  if (result.value === undefined) return result as SourceResult<DiscoveryOutcome>;

  const outcome: DiscoveryOutcome = {
    listings: result.value.listings.slice(0, options.limit),
    source: 'fixtures',
    serpApiCalls: 0,
    degraded: result.status === 'stale',
  };

  return result.status === 'stale'
    ? stale('discovery', outcome, result.error, result.meta.durationMs, result.meta.degradedBy)
    : ok('discovery', outcome, result.meta.durationMs, true);
}

async function discoverFromSerpApi(
  options: DiscoverOptions,
): Promise<SourceResult<DiscoveryOutcome>> {
  if (!options.serpApiKey) {
    // Config validation normally prevents this, but the function is public and
    // the failure must be honest rather than an empty result.
    return {
      status: 'unavailable',
      kind: 'discovery',
      meta: { durationMs: 0, at: new Date().toISOString() },
      error: {
        code: 'serpapi_key_missing',
        message:
          'DISCOVERY_MODE=live needs SERPAPI_API_KEY. Add it to .env, or set DISCOVERY_MODE=fixtures.',
      },
    };
  }

  const request: SearchRequest = {
    query: options.query,
    location: options.location,
    country: options.country,
  };

  const result = await searchGoogleMaps(
    {
      apiKey: options.serpApiKey,
      cacheDir: options.cacheDir ?? './data/cache/serpapi',
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    },
    request,
  );

  if (result.value === undefined) return result as SourceResult<DiscoveryOutcome>;

  const listings = normalizeSerpApiResponse(result.value.response, options.country);
  const outcome: DiscoveryOutcome = {
    listings: listings.slice(0, options.limit),
    source: result.value.fromCache ? 'serpapi-cache' : 'serpapi',
    serpApiCalls: result.value.fromCache ? 0 : 1,
    degraded: result.status === 'stale',
  };

  return result.status === 'stale'
    ? stale('discovery', outcome, result.error, result.meta.durationMs, result.meta.degradedBy)
    : ok('discovery', outcome, result.meta.durationMs, result.value.fromCache);
}

export interface DedupeInput {
  listings: Listing[];
  repo: LeadRepository;
}

export interface DedupeOutcome {
  /** Listings to insert: unseen place ids, on domains not already contacted. */
  fresh: Listing[];
  /** Listings whose place id is already stored. */
  duplicatePlaceId: Listing[];
  /** Listings whose domain already has a contacted lead. */
  alreadyContacted: Listing[];
}

/**
 * Split discovered listings into the ones worth auditing and the ones to skip.
 *
 * Two rules, in order:
 *
 * 1. A `place_id` already stored is the same listing seen again, so it is not a
 *    new lead. This is what stops a repeat search from flooding the list.
 * 2. A `domain_key` that already has a contacted lead must never be pitched
 *    again, even if the listing itself is new. Two listings pointing at one
 *    website are one business to a human, and a second message reads as spam.
 */
export async function dedupeListings(input: DedupeInput): Promise<DedupeOutcome> {
  const { listings, repo } = input;

  const placeIds = listings.map((listing) => listing.placeId);
  const knownPlaceIds = await repo.knownPlaceIds(placeIds);
  const contactedDomains = await repo.contactedDomainKeys();

  const duplicatePlaceId: Listing[] = [];
  const alreadyContacted: Listing[] = [];
  const fresh: Listing[] = [];

  // A domain repeated within this batch would otherwise produce two fresh leads
  // for one business, since neither is stored yet.
  const seenInBatch = new Set<string>();

  for (const listing of listings) {
    if (knownPlaceIds.has(listing.placeId)) {
      duplicatePlaceId.push(listing);
      continue;
    }

    const domain = listing.domainKey ?? computeDomainKey(listing.websiteUrl);

    if (domain !== undefined) {
      if (contactedDomains.has(domain)) {
        alreadyContacted.push(listing);
        continue;
      }
      if (seenInBatch.has(domain)) {
        duplicatePlaceId.push(listing);
        continue;
      }
      seenInBatch.add(domain);
    }

    fresh.push(listing);
  }

  return { fresh, duplicatePlaceId, alreadyContacted };
}
