/**
 * Domain keys.
 *
 * `domain_key` is how Localscout stops pitching the same business twice. Two
 * Google Maps listings often point at one website, and the same website appears
 * under several listings, so the key is computed from the host with the parts
 * that carry no identity removed.
 *
 * The important case is the one that looks like a website but is not: a listing
 * whose "website" is a Facebook page, an Instagram profile, or a directory
 * entry. Treating those as a site would produce a `NO_WEBSITE` opportunity that
 * is false, and an outreach message about a site the business does not control.
 * So social and directory hosts produce no key at all.
 */

/**
 * Hosts that are not a business's own website.
 *
 * Matching is on the registrable-ish label plus known public suffixes, so
 * `www.facebook.com`, `m.facebook.com`, and `facebook.com` all collapse.
 */
const SOCIAL_HOSTS: readonly string[] = [
  'facebook.com',
  'fb.com',
  'fb.me',
  'm.facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'youtu.be',
  'pinterest.com',
  'tiktok.com',
  'wa.me',
  'whatsapp.com',
  'api.whatsapp.com',
  't.me',
  'telegram.me',
  'threads.net',
];

/** Directories and listing sites. A page here is not the business's own site. */
const DIRECTORY_HOSTS: readonly string[] = [
  'justdial.com',
  'justdial.in',
  'jdm.co.in',
  'sulekha.com',
  'sulekha.in',
  'indiamart.com',
  'indiaMART.com'.toLowerCase(),
  'tradeindia.com',
  'exportersindia.com',
  'magicpin.com',
  'foursquare.com',
  'yelp.com',
  'yellowpages.com',
  'yellow-pages.in',
  'business.site',
  'google.com',
  'goo.gl',
  'maps.app.goo.gl',
  'g.page',
  'linktr.ee',
  'linktr.ee.link',
  'bio.link',
  'beacons.ai',
  'campsite.bio',
  'milkshake.app',
  'linkin.bio',
  'stan.store',
  'dribbble.com',
  'bebbly.io',
  'justme.io',
  'business.site',
  'google.com/urls',
];

/** Query and tracking noise stripped before comparing hosts. */
const JUNK_PARAMS = [/^utm_/i, /^gclid$/i, /^fbclid$/i, /^ref$/i, /^source$/i, /^cid$/i];

/**
 * Normalize a website URL to a comparable domain key.
 *
 * Returns undefined when the URL is unusable, is not http(s), or points at a
 * social or directory host. Undefined means "this lead has no real website",
 * which is a finding in its own right rather than an error.
 */
export function computeDomainKey(rawUrl: string | null | undefined): string | undefined {
  const url = parseUrl(rawUrl);
  if (!url) return undefined;

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  // `hostname` is already lowercased and punycoded by the URL parser.
  const host = stripPort(url.hostname);
  if (host === '') return undefined;

  if (isSocialOrDirectory(host)) return undefined;

  return host.startsWith('www.') ? host.slice(4) : host;
}

/** True when the host is a social profile or a directory page, not a site. */
export function isSocialOrDirectory(host: string): boolean {
  const normalized = stripPort(host.toLowerCase());
  return matchesHost(normalized, SOCIAL_HOSTS) || matchesHost(normalized, DIRECTORY_HOSTS);
}

/**
 * Whether a listing's "website" is actually usable.
 *
 * Used by the audit layer to decide between `NO_WEBSITE` and a real audit.
 */
export function hasRealWebsite(rawUrl: string | null | undefined): boolean {
  return computeDomainKey(rawUrl) !== undefined;
}

/** Strip a trailing dot and any port. */
function stripPort(host: string): string {
  return host.replace(/\.$/, '').replace(/:\d+$/, '');
}

function parseUrl(raw: string | null | undefined): URL | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  // Listings routinely omit the scheme ("example.com/menu"). Assume https,
  // because that is what a modern site serves, and the audit checks HTTPS for
  // real anyway.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withScheme);
  } catch {
    return undefined;
  }
}

/**
 * Match a host against a list.
 *
 * A host matches when it equals an entry or is a subdomain of one, which is what
 * makes `www.facebook.com` and `m.facebook.com` both collapse onto
 * `facebook.com`.
 */
function matchesHost(host: string, list: readonly string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Reduce a URL to a stable cache key for deduplication.
 *
 * Drops the scheme, a leading `www.`, and known tracking parameters, so
 * `http://www.example.com/?utm_source=x` and `https://example.com` share a key.
 */
export function canonicalizeUrl(rawUrl: string): string | undefined {
  const url = parseUrl(rawUrl);
  if (!url) return undefined;

  // Strip `www.` here too, so a canonical URL and a domain key agree on what
  // "the same site" means. Otherwise `www.example.com` and `example.com` would
  // produce two cache keys for one site.
  const rawHost = stripPort(url.hostname);
  const host = rawHost.startsWith('www.') ? rawHost.slice(4) : rawHost;
  const cleanParams = [...url.searchParams.entries()]
    .filter(([key]) => !JUNK_PARAMS.some((pattern) => pattern.test(key)))
    .sort(([a], [b]) => a.localeCompare(b));

  const query = cleanParams.length > 0 ? `?${new URLSearchParams(cleanParams).toString()}` : '';
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');

  return `${host}${path}${query}`.toLowerCase();
}
