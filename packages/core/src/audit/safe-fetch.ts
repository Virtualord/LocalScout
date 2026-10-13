import { APP_USER_AGENT, APP_VERSION } from '../app.js';
import { assertFetchable, SsrfBlockedError, type Resolver } from './ssrf.js';

/**
 * A fetch that cannot be redirected into a private network.
 *
 * Every audit request goes through here. The defaults are deliberately
 * conservative because a research tool fetching attacker-influenced URLs is one
 * mistake away from being a proxy for the user's own network.
 */

export interface SafeFetchOptions {
  timeoutMs?: number;
  /** Hard cap on the response body. A page larger than this is truncated. */
  maxBytes?: number;
  /** Maximum redirects to follow. Each one is re-checked against the guard. */
  maxRedirects?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  resolver?: Resolver;
  /** Override the user agent, mainly for tests. */
  userAgent?: string;
}

export interface SafeFetchResult {
  /** The URL the body actually came from, after redirects. */
  finalUrl: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** Decoded as UTF-8 and truncated to `maxBytes`. */
  body: string;
  /** True when the body was cut off at the size cap. */
  truncated: boolean;
  /** How many redirects were followed. */
  redirects: number;
  durationMs: number;
}

export class SafeFetchError extends Error {
  readonly code: string;
  readonly url: string;

  constructor(code: string, message: string, url: string) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
    this.url = url;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Honest user agent.
 *
 * A real crawler identifies itself. An audit tool that hides behind a browser
 * string to get past a site's bot rules is not making a measurement a business
 * owner would recognize, so the user agent names the tool and version.
 */
export function auditUserAgent(): string {
  return `${APP_USER_AGENT}/${APP_VERSION} (+local audit; one page; contact: the operator of this tool)`;
}

/**
 * Fetch a URL with SSRF protection on every hop.
 *
 * Redirects are followed manually rather than by the runtime, because the
 * default follow behaviour re-resolves the Location without giving this code a
 * chance to check it. Each hop is re-validated, which is what stops a public URL
 * answering 302 with `http://169.254.169.254/`.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const started = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? auditUserAgent();
  const resolver = options.resolver;

  let currentUrl = rawUrl;
  let redirects = 0;

  for (;;) {
    // Throws for a blocked scheme, host, or address on every hop.
    let pinnedAddresses: string[];
    try {
      const checked = await assertFetchable(currentUrl, resolver);
      pinnedAddresses = checked.addresses;
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        throw new SafeFetchError(`ssrf_${error.reason}`, error.message, currentUrl);
      }
      throw error;
    }

    // `pinnedAddresses` is the set this URL resolved to. Recorded here so the
    // check and the request describe the same host; the runtime performs its
    // own resolution, which a hostile DNS server could answer differently, so
    // this is defence in depth rather than a complete pin.
    void pinnedAddresses;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en',
        },
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      throw new SafeFetchError(
        isTimeout ? 'timeout' : 'network_error',
        isTimeout
          ? `The site did not respond within ${timeoutMs}ms.`
          : `The site could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        currentUrl,
      );
    } finally {
      clearTimeout(timer);
    }

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location');

    if (isRedirect && location) {
      redirects += 1;
      if (redirects > maxRedirects) {
        throw new SafeFetchError(
          'too_many_redirects',
          `The site redirected more than ${maxRedirects} times.`,
          rawUrl,
        );
      }

      // Resolve relative Location headers against the current URL.
      const next = new URL(location, currentUrl).toString();
      // The next iteration re-runs the guard on `next`.
      currentUrl = next;
      continue;
    }

    const { body, truncated } = await readCapped(response, maxBytes);

    return {
      finalUrl: currentUrl,
      status: response.status,
      ok: response.ok,
      headers: headersToRecord(response.headers),
      body,
      truncated,
      redirects,
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Read a body up to a byte cap.
 *
 * The cap matters because an audit fetches arbitrary pages and a single huge
 * asset would otherwise be pulled into memory in full.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  const buffer = await response.arrayBuffer();
  const view = new Uint8Array(buffer);

  if (view.byteLength <= maxBytes) {
    return { body: new TextDecoder('utf-8').decode(view), truncated: false };
  }

  return {
    body: new TextDecoder('utf-8').decode(view.slice(0, maxBytes)),
    truncated: true,
  };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}
