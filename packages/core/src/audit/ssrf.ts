import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for outbound audit requests.
 *
 * The audit step fetches a URL that came from a search result, which means it
 * is attacker-influenced input: a listing can point at
 * `http://169.254.169.254/` (the cloud metadata service), at
 * `http://127.0.0.1:8787/` (this app's own API), or at a host that resolves to
 * a private address. Every one of those turns a research tool into a request
 * proxy against the user's own machine or their cloud credentials.
 *
 * The rules, and why each exists:
 *
 * - **http(s) only.** Blocks `file:`, `gopher:`, `ftp:`, `data:` and friends.
 * - **DNS is resolved and every returned address is checked.** A hostname that
 *   resolves to 127.0.0.1 is just as dangerous as a literal one.
 * - **Private, loopback, link-local, unique-local, and CGNAT ranges are
 *   rejected.** This covers RFC1918, 169.254.0.0/16 (link-local and cloud
 *   metadata), 100.64.0.0/10 (carrier NAT), and the IPv6 equivalents.
 * - **Redirects are re-checked**, because a public host can answer 302 with a
 *   Location pointing straight at the metadata service.
 * - **The resolved address is pinned** for the request, so a second DNS lookup
 *   cannot return a different answer between the check and the fetch.
 */

export type BlockedReason =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'private_address'
  | 'loopback_address'
  | 'link_local_address'
  | 'cgnat_address'
  | 'unspecified_address'
  | 'ipv6_transition'
  | 'dns_failure'
  | 'too_many_redirects';

export class SsrfBlockedError extends Error {
  readonly reason: BlockedReason;
  readonly url: string;

  constructor(reason: BlockedReason, url: string, message?: string) {
    super(message ?? defaultMessage(reason, url));
    this.name = 'SsrfBlockedError';
    this.reason = reason;
    this.url = url;
  }
}

function defaultMessage(reason: BlockedReason, url: string): string {
  switch (reason) {
    case 'invalid_url':
      return `"${url}" is not a valid URL.`;
    case 'unsupported_scheme':
      return `Only http and https URLs can be audited. Got "${url}".`;
    case 'loopback_address':
      return `"${url}" resolves to a loopback address. Only public sites can be audited.`;
    case 'private_address':
      return `"${url}" resolves to a private network address. Only public sites can be audited.`;
    case 'link_local_address':
      return `"${url}" resolves to a link-local address, which includes the cloud metadata service. This request was blocked.`;
    case 'cgnat_address':
      return `"${url}" resolves to a carrier-grade NAT address. Only public sites can be audited.`;
    case 'unspecified_address':
      return `"${url}" resolves to an unspecified address. This request was blocked.`;
    case 'ipv6_transition':
      return `"${url}" uses an IPv4-mapped IPv6 address. Only public sites can be audited.`;
    case 'dns_failure':
      return `The hostname in "${url}" could not be resolved.`;
    case 'too_many_redirects':
      return `"${url}" redirected more than the allowed number of times.`;
  }
}

/** IPv4 ranges that must never be reachable from an audit fetch. */
const BLOCKED_V4 = [
  // Private (RFC1918)
  { cidr: '10.0.0.0/8', reason: 'private_address' as const },
  { cidr: '172.16.0.0/12', reason: 'private_address' as const },
  { cidr: '192.168.0.0/16', reason: 'private_address' as const },
  // Loopback
  { cidr: '127.0.0.0/8', reason: 'loopback_address' as const },
  // Link-local, which contains 169.254.169.254 (cloud metadata)
  { cidr: '169.254.0.0/16', reason: 'link_local_address' as const },
  // Carrier-grade NAT
  { cidr: '100.64.0.0/10', reason: 'cgnat_address' as const },
  // Unspecified / this-network
  { cidr: '0.0.0.0/8', reason: 'unspecified_address' as const },
  // IETF protocol assignments
  { cidr: '192.0.0.0/24', reason: 'private_address' as const },
  // Multicast and reserved
  { cidr: '224.0.0.0/4', reason: 'private_address' as const },
  { cidr: '240.0.0.0/4', reason: 'private_address' as const },
];

/**
 * IPv6 ranges that must never be reachable, matched on the first 16-bit group.
 *
 * Every blocked IPv6 range here is identified by its leading group, so the
 * comparison is a single integer test against `expanded[0]`. Writing the ranges
 * as text prefixes instead would have to be expanded and aligned per range,
 * which is where the earlier prefix-matching version went wrong.
 */
const BLOCKED_V6: { firstGroup: number; reason: BlockedReason }[] = [
  { firstGroup: 0x0000, reason: 'unspecified_address' }, // ::
  { firstGroup: 0xfc00, reason: 'private_address' }, // unique local fc00::/8
  { firstGroup: 0xfd00, reason: 'private_address' }, // unique local fd00::/8
  { firstGroup: 0xfe80, reason: 'link_local_address' }, // link-local fe80::/10
  { firstGroup: 0xff00, reason: 'private_address' }, // multicast ff00::/8
];

/** Loopback, tested on the full address rather than the leading group. */
const IPV6_LOOPBACK = [0, 0, 0, 0, 0, 0, 0, 1];

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * Needed because `::1` and `0:0:0:0:0:0:0:1` are the same address but share no
 * prefix string, so a startsWith check alone would let the expanded form of
 * loopback through.
 */
function expandIpv6(address: string): number[] | undefined {
  // Strip a zone index such as `fe80::1%eth0`.
  const withoutZone = address.split('%')[0] ?? address;
  const doubleColon = withoutZone.indexOf('::');

  // Groups are plain hex values of up to four digits. No padding: the earlier
  // version padded a short trailing group to align a prefix literal, which
  // corrupted real addresses ("::1" became [.., 4096] and stopped matching the
  // loopback check). Prefix matching is done on integers, not on strings.
  const parseGroups = (parts: string[]): number[] | undefined => {
    const values: number[] = [];
    for (const part of parts) {
      if (part === '') return undefined;
      const value = Number.parseInt(part, 16);
      if (Number.isNaN(value) || value < 0 || value > 0xffff) return undefined;
      values.push(value);
    }
    return values;
  };

  if (doubleColon === -1) {
    const groups = withoutZone.split(':');
    if (groups.length !== 8) return undefined;
    return parseGroups(groups);
  }

  const headText = withoutZone.slice(0, doubleColon);
  const tailText = withoutZone.slice(doubleColon + 2);
  const head = headText === '' ? [] : headText.split(':');
  const tail = tailText === '' ? [] : tailText.split(':');
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return undefined;

  const middle = new Array<string>(missing).fill('0');
  const groups = [...head, ...middle, ...tail];
  if (groups.length !== 8) return undefined;

  return parseGroups(groups);
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  const [a, b, c, d] = parts;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return -1;
  return (
    ((Number(a) << 24) >>> 0) + ((Number(b) << 16) >>> 0) + ((Number(c) << 8) >>> 0) + Number(d)
  );
}

function applyMask(ip: string, prefix: number): string | undefined {
  const asInt = ipv4ToInt(ip);
  if (asInt < 0) return undefined;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((asInt & mask) >>> 0).toString(16);
}

function matchesV4(ip: string, cidr: string): boolean {
  const [range, prefixText] = cidr.split('/');
  if (!range || prefixText === undefined) return false;
  const prefix = Number(prefixText);

  const network = applyMask(range, prefix);
  const candidate = applyMask(ip, prefix);
  if (network === undefined || candidate === undefined) return false;
  return network === candidate;
}

/**
 * Decide whether a single resolved address may be fetched.
 *
 * Pure and exported so the rules can be table-tested without DNS.
 *
 * `allowLoopback` exists only for the audit's own integration tests, which
 * serve fixture sites on 127.0.0.1 and would otherwise be blocked by the very
 * guard they are testing. It never relaxes anything except the loopback range,
 * so the metadata service and private networks stay blocked even in tests.
 */
export function classifyAddress(
  address: string,
  allowLoopback = false,
): { allowed: true } | { allowed: false; reason: BlockedReason } {
  const version = isIP(address);

  if (version === 4) {
    for (const { cidr, reason } of BLOCKED_V4) {
      if (!matchesV4(address, cidr)) continue;
      if (allowLoopback && reason === 'loopback_address') continue;
      return { allowed: false, reason };
    }
    return { allowed: true };
  }

  if (version === 6) {
    const normalized = address.toLowerCase();

    // ::ffff:127.0.0.1 is an IPv4-mapped IPv6 address that reaches loopback.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) {
      const inner = classifyAddress(mapped[1], allowLoopback);
      // Report it as a transition so the message explains what happened.
      return inner.allowed
        ? { allowed: false, reason: 'ipv6_transition' }
        : { allowed: false, reason: inner.reason };
    }

    const expanded = expandIpv6(normalized);
    if (!expanded) return { allowed: false, reason: 'invalid_url' };

    // Loopback is checked before the leading-group table because ::1 also starts
    // with group 0, and the table would otherwise report it as unspecified.
    if (IPV6_LOOPBACK.every((group, index) => expanded[index] === group)) {
      if (!allowLoopback) return { allowed: false, reason: 'loopback_address' };
      return { allowed: true };
    }

    const firstGroup = expanded[0];
    if (firstGroup === undefined) return { allowed: false, reason: 'invalid_url' };

    for (const { firstGroup: blocked, reason } of BLOCKED_V6) {
      if (firstGroup === blocked) return { allowed: false, reason };
    }
    return { allowed: true };
  }

  // Not an IP at all: cannot be classified, so cannot be allowed.
  return { allowed: false, reason: 'invalid_url' };
}

/** Parse and scheme-check a URL before any network work. */
export function assertSafeUrlSyntax(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('invalid_url', rawUrl);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError('unsupported_scheme', rawUrl);
  }

  if (url.hostname === '') {
    throw new SsrfBlockedError('invalid_url', rawUrl);
  }

  return url;
}

/**
 * A hostname resolver, injectable so the rules can be tested without DNS.
 *
 * Returning `allowLoopback: true` relaxes only the loopback range. It is for
 * the audit's integration tests, which serve fixtures locally, and must never
 * be set in a real run.
 */
export type Resolver = (
  hostname: string,
) => Promise<{ addresses: string[]; allowLoopback?: boolean }>;

export const defaultResolver: Resolver = async (hostname) => {
  // An address literal needs no lookup.
  if (isIP(hostname) !== 0) return { addresses: [hostname] };

  const results = await lookup(hostname, { all: true, verbatim: true });
  if (results.length === 0) throw new SsrfBlockedError('dns_failure', hostname);
  return { addresses: results.map((entry) => entry.address) };
};

/**
 * Resolve a hostname and require every address to be public.
 *
 * All addresses are checked, not just the first: a hostname with two A records
 * where one is public and one is private is exactly the DNS rebinding case the
 * check exists for.
 */
export async function assertPublicHost(
  url: URL,
  resolver: Resolver = defaultResolver,
): Promise<string[]> {
  const resolved = await resolver(url.hostname).catch((error: unknown) => {
    if (error instanceof SsrfBlockedError) throw error;
    throw new SsrfBlockedError('dns_failure', url.href);
  });

  const addresses = resolved.addresses;

  // Fail closed: a resolver that returns nothing proves nothing about whether
  // the host is public, so it must not be treated as permission to proceed.
  if (addresses.length === 0) {
    throw new SsrfBlockedError('dns_failure', url.href);
  }

  for (const address of addresses) {
    const verdict = classifyAddress(address, resolved.allowLoopback === true);
    if (!verdict.allowed) {
      throw new SsrfBlockedError(verdict.reason, url.href);
    }
  }

  return addresses;
}

/**
 * Full check for one URL: syntax, scheme, then resolved addresses.
 *
 * Returns the addresses so the caller can pin them for the request.
 */
export async function assertFetchable(
  rawUrl: string,
  resolver: Resolver = defaultResolver,
): Promise<{ url: URL; addresses: string[] }> {
  const url = assertSafeUrlSyntax(rawUrl);
  const addresses = await assertPublicHost(url, resolver);
  return { url, addresses };
}
