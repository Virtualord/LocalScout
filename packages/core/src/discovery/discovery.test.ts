import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { createRepositories, type Repositories } from '../db/repositories/index.js';
import { dedupeListings, discover } from './discover.js';
import { narrowByQuery, searchFixtures } from './fixtures.js';
import { normalizePlace, normalizeSerpApiResponse } from './normalize.js';
import { buildSearchUrl, cacheKeyFor, searchGoogleMaps } from './serpapi.client.js';
import type { Listing, SerpApiResponse } from './normalize.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'serpapi');

describe('discovery normalization', () => {
  it('maps a complete place object', () => {
    const listing = normalizePlace(
      {
        title: 'Sharma Plumbing Works',
        place_id: 'place_1',
        gps_coordinates: { latitude: 23.2312, longitude: 77.4231 },
        rating: 4.6,
        reviews: 214,
        type: 'Plumber',
        address: 'MP Nagar, Bhopal',
        phone: '+91 98123 45678',
        website: 'https://sharmaplumbing.in/',
      },
      'IN',
    );

    expect(listing).toMatchObject({
      placeId: 'place_1',
      name: 'Sharma Plumbing Works',
      category: 'Plumber',
      address: 'MP Nagar, Bhopal',
      lat: 23.2312,
      lng: 77.4231,
      rating: 4.6,
      reviewCount: 214,
      phoneE164: '+919812345678',
      phoneIsMobile: true,
      domainKey: 'sharmaplumbing.in',
    });
  });

  it('drops a place with no id or no title rather than inventing one', () => {
    expect(normalizePlace({ title: 'No Id' }, 'IN')).toBeUndefined();
    expect(normalizePlace({ place_id: 'p1' }, 'IN')).toBeUndefined();
    expect(normalizePlace({}, 'IN')).toBeUndefined();
  });

  it('leaves domainKey undefined for a social-only listing', () => {
    const listing = normalizePlace(
      { title: 'Patel Coolers', place_id: 'p2', website: 'https://facebook.com/patelcoolers' },
      'IN',
    );
    expect(listing?.websiteUrl).toBe('https://facebook.com/patelcoolers');
    expect(listing?.domainKey).toBeUndefined();
  });

  it('coerces numeric strings and rejects non-numbers', () => {
    const listing = normalizePlace(
      {
        title: 'Odd Data',
        place_id: 'p3',
        rating: '4.5' as unknown as number,
        reviews: 'not a number' as unknown as number,
        gps_coordinates: { latitude: NaN },
      },
      'IN',
    );

    expect(listing?.rating).toBe(4.5);
    expect(listing?.reviewCount).toBeUndefined();
    expect(listing?.lat).toBeUndefined();
  });

  it('reads the first type when the plural field is used', () => {
    const listing = normalizePlace(
      { title: 'Multi Type', place_id: 'p4', types: ['Plumber', 'Contractor'] },
      'IN',
    );
    expect(listing?.category).toBe('Plumber');
  });

  it('handles a response with no local results', () => {
    expect(normalizeSerpApiResponse({}, 'IN')).toEqual([]);
    expect(normalizeSerpApiResponse({ local_results: [] }, 'IN')).toEqual([]);
  });
});

describe('serpapi client', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'localscout-serpapi-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const request = { query: 'plumbers', location: 'Bhopal', country: 'IN' };

  it('builds a google maps request url with the key', () => {
    const url = new URL(buildSearchUrl(request, 'secret-key'));
    expect(url.searchParams.get('engine')).toBe('google_maps');
    expect(url.searchParams.get('type')).toBe('search');
    expect(url.searchParams.get('q')).toBe('plumbers');
    expect(url.searchParams.get('gl')).toBe('in');
    expect(url.searchParams.get('api_key')).toBe('secret-key');
  });

  /*
   * The place goes in `location` with a zoom, never in `ll`.
   *
   * `ll` is the coordinates parameter and must read `@23.2599,77.4126,12z`. This
   * builder used to put the city name there, and SerpApi answered every live
   * search with "Invalid format of the `ll` parameter" — so live discovery had
   * never worked, and this test passed the whole time because it asserted the
   * broken value. These two assertions are the reason it cannot recur: `ll` is
   * asserted absent, and `location` is asserted present with the zoom SerpApi
   * requires alongside it.
   */
  it('sends the place in location with a zoom, never a bare place name in ll', () => {
    const url = new URL(buildSearchUrl(request, 'secret-key'));

    expect(url.searchParams.get('location')).toBe('Bhopal');
    expect(url.searchParams.has('ll')).toBe(false);

    // SerpApi rejects `location` without `z` or `m`, so the zoom is load-bearing
    // rather than a tuning knob.
    expect(url.searchParams.get('z')).toMatch(/^\d+$/);
    expect(Number(url.searchParams.get('z'))).toBeGreaterThanOrEqual(3);
    expect(Number(url.searchParams.get('z'))).toBeLessThanOrEqual(30);
  });

  it('never puts the api key in the cache key', () => {
    const key = cacheKeyFor(request);
    expect(key).not.toContain('secret');
    expect(key).toMatch(/^[a-f0-9]{32}$/);
  });

  it('gives the same key for the same query and a different one otherwise', () => {
    expect(cacheKeyFor(request)).toBe(cacheKeyFor({ ...request, query: '  PLUMBERS ' }));
    expect(cacheKeyFor(request)).not.toBe(cacheKeyFor({ ...request, query: 'electricians' }));
    expect(cacheKeyFor(request)).not.toBe(cacheKeyFor({ ...request, location: 'Indore' }));
  });

  it('calls the API once and serves the second call from disk', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          search_metadata: { status: 'Success' },
          local_results: [{ title: 'A', place_id: '1' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const options = { apiKey: 'k', cacheDir: dir, fetchImpl };

    const first = await searchGoogleMaps(options, request);
    expect(first.status).toBe('ok');
    expect(first.value?.fromCache).toBe(false);
    expect(calls).toBe(1);

    const second = await searchGoogleMaps(options, request);
    expect(second.value?.fromCache).toBe(true);
    // The whole point of the cache: the second run costs nothing.
    expect(calls).toBe(1);
  });

  it('reports an http error as stale with no places', async () => {
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 429 });
    const result = await searchGoogleMaps({ apiKey: 'k', cacheDir: dir, fetchImpl }, request);

    expect(result.status).toBe('stale');
    expect(result.error?.code).toBe('serpapi_http_error');
    expect(result.error?.message).toContain('429');
    expect(result.value?.response.local_results).toEqual([]);
  });

  it('reports an error embedded in a 200 body', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ search_metadata: { status: 'Error' } }), { status: 200 });
    const result = await searchGoogleMaps({ apiKey: 'k', cacheDir: dir, fetchImpl }, request);

    expect(result.status).toBe('stale');
    expect(result.error?.code).toBe('serpapi_error');
  });

  it('reports a network failure as stale with a fixable message', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await searchGoogleMaps({ apiKey: 'k', cacheDir: dir, fetchImpl }, request);

    expect(result.status).toBe('stale');
    expect(result.error?.code).toBe('serpapi_unreachable');
    expect(result.error?.message).toContain('DISCOVERY_MODE=fixtures');
  });

  it('reports a timeout distinctly', async () => {
    const fetchImpl: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });

    const result = await searchGoogleMaps(
      { apiKey: 'k', cacheDir: dir, fetchImpl, timeoutMs: 20 },
      request,
    );
    expect(result.error?.code).toBe('serpapi_timeout');
  });

  it('recovers from a corrupt cache entry by refetching', async () => {
    const key = cacheKeyFor(request);
    const file = join(dir, `${key}.json`);
    // Simulate a truncated write from an interrupted run.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, '{not valid json', 'utf8');

    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ search_metadata: { status: 'Success' }, local_results: [] }),
        {
          status: 200,
        },
      );
    };

    const result = await searchGoogleMaps({ apiKey: 'k', cacheDir: dir, fetchImpl }, request);
    expect(calls).toBe(1);
    expect(result.status).toBe('ok');
  });

  it('does not cache a failed response', async () => {
    const fetchImpl: typeof fetch = async () => new Response('bad', { status: 500 });
    await searchGoogleMaps({ apiKey: 'k', cacheDir: dir, fetchImpl }, request);

    let calls = 0;
    const countingFetch: typeof fetch = async () => {
      calls += 1;
      return new Response('bad', { status: 500 });
    };
    await searchGoogleMaps({ apiKey: 'k', cacheDir: dir, fetchImpl: countingFetch }, request);
    // A failed call must not poison the cache with an empty result.
    expect(calls).toBe(1);
  });
});

describe('fixtures mode', () => {
  it('finds a recorded city exactly', async () => {
    const result = await searchFixtures({ defaultCountry: 'IN' }, 'plumbers', 'Bhopal');
    expect(result.status).toBe('ok');
    expect(result.value?.fixture).toBe('google_maps_bhopal.json');
    expect(result.value?.exactMatch).toBe(true);
    expect(result.value?.listings.length).toBeGreaterThan(0);
  });

  it('falls back to the closest city and says so', async () => {
    const result = await searchFixtures({ defaultCountry: 'IN' }, 'plumbers', 'Bhopal, MP');
    expect(result.status).toBe('stale');
    expect(result.error?.code).toBe('fixtures_nearest_city');
    expect(result.value?.fixture).toBe('google_maps_bhopal.json');
  });

  it('reports an unknown city instead of returning nothing silently', async () => {
    const result = await searchFixtures({ defaultCountry: 'IN' }, 'plumbers', 'Atlantis');
    expect(result.status).toBe('unavailable');
    expect(result.error?.code).toBe('fixtures_no_match');
    expect(result.error?.message).toContain('bhopal');
  });

  it('reports a missing fixture directory with the command to fix it', async () => {
    const result = await searchFixtures(
      { defaultCountry: 'IN', dir: '/tmp/localscout-does-not-exist' },
      'plumbers',
      'Bhopal',
    );
    expect(result.status).toBe('unavailable');
    expect(result.error?.code).toBe('fixtures_missing');
    expect(result.error?.message).toContain('fixtures:generate');
  });

  it('loads every recorded city from the repo', async () => {
    for (const city of ['Bhopal', 'Indore', 'Jaipur']) {
      const result = await searchFixtures({ defaultCountry: 'IN' }, 'services', city);
      expect(result.status, city).toBe('ok');
      expect(result.value?.listings.length).toBeGreaterThan(0);
    }
  });

  describe('the committed fixture set', () => {
    it('has at least 30 listings', async () => {
      const all = await loadAllFixtureListings();
      expect(all.length).toBeGreaterThanOrEqual(30);
    });

    it('covers businesses with no website at all', async () => {
      const all = await loadAllFixtureListings();
      expect(all.filter((l) => l.websiteUrl === undefined).length).toBeGreaterThan(0);
    });

    it('covers social-only listings, which must get no domain key', async () => {
      const all = await loadAllFixtureListings();
      const social = all.filter((l) => l.websiteUrl !== undefined && l.domainKey === undefined);
      expect(social.length).toBeGreaterThan(0);
      for (const listing of social) {
        expect(listing.websiteUrl).toMatch(/facebook|instagram|linktr|sulekha|justdial/i);
      }
    });

    it('has unique place ids across every city', async () => {
      const all = await loadAllFixtureListings();
      const ids = all.map((l) => l.placeId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('mixes mobile and non-mobile numbers', async () => {
      const all = await loadAllFixtureListings();
      expect(all.filter((l) => l.phoneIsMobile).length).toBeGreaterThan(0);
      expect(all.filter((l) => !l.phoneIsMobile).length).toBeGreaterThan(0);
    });

    it('matches the documented SerpApi response shape', () => {
      const raw = JSON.parse(
        readFileSync(join(FIXTURES_DIR, 'google_maps_bhopal.json'), 'utf8'),
      ) as SerpApiResponse;

      expect(raw.search_metadata?.status).toBe('Success');
      expect(raw.search_parameters?.['engine']).toBe('google_maps');
      const first = raw.local_results?.[0];
      expect(first).toMatchObject({
        title: expect.any(String),
        place_id: expect.any(String),
        gps_coordinates: { latitude: expect.any(Number), longitude: expect.any(Number) },
        rating: expect.any(Number),
        reviews: expect.any(Number),
      });
    });
  });
});

async function loadAllFixtureListings(): Promise<Listing[]> {
  const cities = ['Bhopal', 'Indore', 'Jaipur'];
  const all: Listing[] = [];
  for (const city of cities) {
    const result = await searchFixtures({ defaultCountry: 'IN' }, '', city);
    if (result.value) all.push(...result.value.listings);
  }
  return all;
}

describe('narrowByQuery', () => {
  const listings: Listing[] = [
    makeListing('1', 'Sharma Plumbing', 'Plumber'),
    makeListing('2', 'Verma Electricals', 'Electrician'),
    makeListing('3', 'Gupta Interiors', 'Interior designer'),
  ];

  it('keeps only matches when there are any', () => {
    expect(narrowByQuery(listings, 'plumber').map((l) => l.name)).toEqual(['Sharma Plumbing']);
  });

  it('matches on category too', () => {
    expect(narrowByQuery(listings, 'electrician').map((l) => l.name)).toEqual([
      'Verma Electricals',
    ]);
  });

  it('returns everything when nothing matches', () => {
    expect(narrowByQuery(listings, 'dentist')).toHaveLength(3);
  });

  it('returns everything for an empty query', () => {
    expect(narrowByQuery(listings, '')).toHaveLength(3);
  });

  it('ignores very short terms', () => {
    expect(narrowByQuery(listings, 'a')).toHaveLength(3);
  });
});

function makeListing(placeId: string, name: string, category: string): Listing {
  return {
    placeId,
    name,
    category,
    address: undefined,
    lat: undefined,
    lng: undefined,
    phone: undefined,
    phoneE164: undefined,
    phoneIsMobile: false,
    websiteUrl: undefined,
    domainKey: undefined,
    rating: undefined,
    reviewCount: undefined,
  };
}

describe('dedupe against stored leads', () => {
  let dir: string;
  let handle: Db;
  let repos: Repositories;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'localscout-dedupe-'));
    const url = join(dir, 'test.db');
    runMigrations({ url });
    handle = openDb({ url });
    repos = createRepositories(handle);
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const seed = async (over: Partial<Listing>) =>
    repos.leads.insert({
      placeId: over.placeId ?? 'p',
      name: over.name ?? 'Business',
      domainKey: over.domainKey,
      websiteUrl: over.websiteUrl,
    });

  it('keeps everything on a first run', async () => {
    const { fresh, duplicatePlaceId, alreadyContacted } = await dedupeListings({
      listings: [makeListing('1', 'A', 'Plumber'), makeListing('2', 'B', 'Plumber')],
      repo: repos.leads,
    });

    expect(fresh).toHaveLength(2);
    expect(duplicatePlaceId).toHaveLength(0);
    expect(alreadyContacted).toHaveLength(0);
  });

  it('skips a place id already stored', async () => {
    await seed({ placeId: '1', name: 'A' });
    const { fresh, duplicatePlaceId } = await dedupeListings({
      listings: [makeListing('1', 'A', 'Plumber'), makeListing('2', 'B', 'Plumber')],
      repo: repos.leads,
    });

    expect(fresh.map((l) => l.name)).toEqual(['B']);
    expect(duplicatePlaceId.map((l) => l.name)).toEqual(['A']);
  });

  it('never pitches a contacted domain again, even from a new listing', async () => {
    const stored = await seed({ placeId: '1', name: 'Old Listing', domainKey: 'example.com' });
    await repos.leads.setStatus(stored.id, 'sent');

    const { fresh, alreadyContacted } = await dedupeListings({
      listings: [makeListing('2', 'New Listing', 'Plumber')].map((l) => ({
        ...l,
        domainKey: 'example.com',
      })),
      repo: repos.leads,
    });

    expect(fresh).toHaveLength(0);
    expect(alreadyContacted).toHaveLength(1);
  });

  it('collapses two fresh listings that share a domain', async () => {
    // Neither is stored yet, so the place-id rule cannot catch this pair.
    const { fresh, duplicatePlaceId } = await dedupeListings({
      listings: [
        { ...makeListing('1', 'Branch A', 'Plumber'), domainKey: 'example.com' },
        { ...makeListing('2', 'Branch B', 'Plumber'), domainKey: 'example.com' },
      ],
      repo: repos.leads,
    });

    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.name).toBe('Branch A');
    expect(duplicatePlaceId).toHaveLength(1);
  });

  it('allows a contacted domain when the listing has no domain at all', async () => {
    const stored = await seed({ placeId: '1', name: 'Old', domainKey: 'example.com' });
    await repos.leads.setStatus(stored.id, 'sent');

    const { fresh } = await dedupeListings({
      listings: [makeListing('2', 'No Website Business', 'Plumber')],
      repo: repos.leads,
    });
    expect(fresh).toHaveLength(1);
  });
});

describe('discover()', () => {
  it('returns fixture listings with no api calls in fixtures mode', async () => {
    const result = await discover({
      mode: 'fixtures',
      query: 'plumbers',
      location: 'Bhopal',
      country: 'IN',
      limit: 5,
      fixturesDir: FIXTURES_DIR,
    });

    expect(result.status).toBe('ok');
    expect(result.value?.source).toBe('fixtures');
    expect(result.value?.serpApiCalls).toBe(0);
    expect(result.value?.listings.length).toBeLessThanOrEqual(5);
  });

  it('honours the limit', async () => {
    const result = await discover({
      mode: 'fixtures',
      query: '',
      location: 'Jaipur',
      country: 'IN',
      limit: 3,
      fixturesDir: FIXTURES_DIR,
    });
    expect(result.value?.listings).toHaveLength(3);
  });

  it('refuses live mode without a key rather than returning nothing', async () => {
    const result = await discover({
      mode: 'live',
      query: 'plumbers',
      location: 'Bhopal',
      country: 'IN',
      limit: 10,
      serpApiKey: undefined,
    });

    expect(result.status).toBe('unavailable');
    expect(result.error?.code).toBe('serpapi_key_missing');
  });

  it('counts a paid SerpApi call but not a cached one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'localscout-discover-'));
    try {
      const fetchImpl: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            search_metadata: { status: 'Success' },
            local_results: [{ title: 'A', place_id: '1', website: 'https://a.com' }],
          }),
          { status: 200 },
        );

      const base = {
        mode: 'live' as const,
        query: 'plumbers',
        location: 'Bhopal',
        country: 'IN',
        limit: 10,
        serpApiKey: 'k',
        cacheDir: dir,
        fetchImpl,
      };

      const paid = await discover(base);
      expect(paid.value?.serpApiCalls).toBe(1);
      expect(paid.value?.source).toBe('serpapi');

      const cached = await discover(base);
      expect(cached.value?.serpApiCalls).toBe(0);
      expect(cached.value?.source).toBe('serpapi-cache');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
