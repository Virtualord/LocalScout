export {
  canonicalizeUrl,
  computeDomainKey,
  hasRealWebsite,
  isSocialOrDirectory,
} from './domain-key.js';
export {
  dedupeListings,
  discover,
  type DedupeInput,
  type DedupeOutcome,
  type DiscoverOptions,
  type DiscoveryOutcome,
} from './discover.js';
export {
  narrowByQuery,
  searchFixtures,
  type FixturesOptions,
  type FixturesOutcome,
} from './fixtures.js';
export {
  normalizePlace,
  normalizeSerpApiResponse,
  type Listing,
  type RawPlace,
  type SerpApiResponse,
} from './normalize.js';
export {
  buildSearchUrl,
  cacheFileFor,
  cacheKeyFor,
  searchGoogleMaps,
  type SearchOutcome,
  type SearchRequest,
  type SerpApiClientOptions,
} from './serpapi.client.js';
