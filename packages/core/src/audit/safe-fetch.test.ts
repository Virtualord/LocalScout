import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FixtureServer, startFixtureServer } from './fixture-server.js';
import { auditUserAgent, SafeFetchError, safeFetch } from './safe-fetch.js';
import type { Resolver } from './ssrf.js';

/**
 * The guard would normally refuse these URLs because they are on 127.0.0.1.
 * This resolver answers 127.0.0.1 only for the loopback host and defers to the
 * real resolver for everything else, so a redirect to the metadata address is
 * still classified correctly rather than being masked by the override.
 */
const allowLoopback = async (hostname: string) => {
  // An IP literal is answered as itself, so the guard classifies the real
  // address and the metadata IP stays blocked.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return { addresses: [hostname] };
  // No network in tests: hand back a public address for any other name.
  return { addresses: ['93.184.216.34'] };
};

/** The one relaxation the fixture tests need, scoped to the loopback range. */
const fixtureResolver: Resolver = async (hostname) => {
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return { addresses: ['127.0.0.1'], allowLoopback: true };
  }
  return allowLoopback(hostname);
};

describe('safeFetch against local fixture sites', () => {
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer();
  });

  afterAll(async () => {
    await server.close();
  });

  const fetchLocal = (path: string, options: Parameters<typeof safeFetch>[1] = {}) =>
    safeFetch(server.url(path), { resolver: fixtureResolver, ...options });

  it('fetches a page and returns its body', async () => {
    const result = await fetchLocal('/good');
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.body).toContain('Sharma Plumbing Works');
    expect(result.redirects).toBe(0);
  });

  it('sends an honest user agent naming the tool', async () => {
    expect(auditUserAgent()).toMatch(/^LocalscoutAudit\/\d+\.\d+\.\d+/);
    // It must not impersonate a browser.
    expect(auditUserAgent().toLowerCase()).not.toContain('mozilla');
    expect(auditUserAgent().toLowerCase()).not.toContain('chrome');
  });

  it('reports a 404 without throwing', async () => {
    const result = await fetchLocal('/not-found');
    expect(result.status).toBe(404);
    expect(result.ok).toBe(false);
  });

  it('reports a 500 without throwing', async () => {
    const result = await fetchLocal('/server-error');
    expect(result.status).toBe(500);
    expect(result.ok).toBe(false);
  });

  it('handles a non-html response', async () => {
    const result = await fetchLocal('/not-html');
    expect(result.headers['content-type']).toContain('application/pdf');
  });

  it('times out on a slow page rather than hanging', async () => {
    await expect(fetchLocal('/slow', { timeoutMs: 150 })).rejects.toThrow(SafeFetchError);
    await expect(fetchLocal('/slow', { timeoutMs: 150 })).rejects.toThrow(/did not respond/);
  });

  it('truncates a body beyond the size cap', async () => {
    const result = await fetchLocal('/good', { maxBytes: 50 });
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBeLessThanOrEqual(50);
  });

  it('does not truncate a body under the cap', async () => {
    const result = await fetchLocal('/good', { maxBytes: 1024 * 1024 });
    expect(result.truncated).toBe(false);
  });

  it('refuses a redirect into the metadata service', async () => {
    // The single most important case: a public page answering 302 with the
    // cloud metadata address must not be followed.
    await expect(fetchLocal('/redirect-to-private')).rejects.toThrow(SafeFetchError);
    await expect(fetchLocal('/redirect-to-private')).rejects.toThrow(/metadata service/);
  });

  it('reports the blocking reason on the error', async () => {
    try {
      await fetchLocal('/redirect-to-private');
      expect.unreachable('should have blocked');
    } catch (error) {
      expect(error).toBeInstanceOf(SafeFetchError);
      expect((error as SafeFetchError).code).toBe('ssrf_link_local_address');
    }
  });

  it('refuses a non-http url before making any request', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/Only http and https/);
  });

  it('refuses a loopback host when no resolver override is given', async () => {
    await expect(safeFetch('http://127.0.0.1:9/')).rejects.toThrow(SafeFetchError);
  });

  it('gives up after too many redirects', async () => {
    // A self-redirecting loop, to prove the counter terminates.
    const fetchImpl: typeof fetch = async () =>
      new Response('', { status: 302, headers: { location: 'http://example.com/loop' } });

    await expect(
      safeFetch('http://example.com/', {
        fetchImpl,
        resolver: async () => ({ addresses: ['93.184.216.34'] }),
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/redirected more than 2 times/);
  });

  it('resolves a relative redirect against the current url', async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      seen.push(String(url));
      if (seen.length === 1) {
        return new Response('', { status: 302, headers: { location: '/final' } });
      }
      return new Response('<h1>final</h1>', { status: 200 });
    };

    const result = await safeFetch('http://example.com/start', {
      fetchImpl,
      resolver: async () => ({ addresses: ['93.184.216.34'] }),
    });

    expect(result.finalUrl).toBe('http://example.com/final');
    expect(seen).toEqual(['http://example.com/start', 'http://example.com/final']);
  });

  it('reports a network failure as a SafeFetchError', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };

    await expect(
      safeFetch('http://example.com/', {
        fetchImpl,
        resolver: async () => ({ addresses: ['93.184.216.34'] }),
      }),
    ).rejects.toThrow(/could not be reached/);
  });
});

/**
 * The size cap has to bound memory, not just the returned string.
 *
 * Nothing here uses the fixture server: each test needs a body that can be
 * counted as it is pulled, which is the only way to see the difference between
 * "stopped reading" and "read everything, then sliced".
 */
describe('safeFetch body cap', () => {
  const publicResolver: Resolver = async () => ({ addresses: ['93.184.216.34'] });

  /** A response that hands out `chunks` on demand and counts what was pulled. */
  function countedStream(chunks: Uint8Array[]): {
    response: Response;
    pulled: () => number;
    cancelled: () => boolean;
  } {
    let pulled = 0;
    let cancelled = false;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pulled];
        pulled += 1;
        if (chunk === undefined) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    return {
      response: new Response(body, { status: 200 }),
      pulled: () => pulled,
      cancelled: () => cancelled,
    };
  }

  it('stops reading at the cap rather than buffering the whole body', async () => {
    const chunk = new Uint8Array(1024).fill(65);
    const stream = countedStream(Array.from({ length: 64 }, () => chunk));

    const result = await safeFetch('http://example.com/big', {
      fetchImpl: async () => stream.response,
      resolver: publicResolver,
      maxBytes: 4096,
    });

    expect(result.truncated).toBe(true);
    expect(result.body.length).toBe(4096);
    // The stream is closed rather than left to drain.
    expect(stream.cancelled()).toBe(true);
    // Proportional to the cap, not to the body: 64 KiB was offered, and a
    // handful of chunks is all it should have taken. `arrayBuffer` would have
    // pulled all 64 before slicing.
    expect(stream.pulled()).toBeLessThan(10);
  });

  it('does not call a body that ends exactly at the cap truncated', async () => {
    const stream = countedStream([new Uint8Array(64).fill(65)]);

    const result = await safeFetch('http://example.com/exact', {
      fetchImpl: async () => stream.response,
      resolver: publicResolver,
      maxBytes: 64,
    });

    expect(result.truncated).toBe(false);
    expect(result.body).toHaveLength(64);
  });

  it('decodes a multi-byte character split across a chunk boundary', async () => {
    // Every Devanagari letter is three UTF-8 bytes, so slicing at byte two
    // splits one in half. A decoder called per chunk emits a replacement
    // character here; a streaming one carries the partial sequence over.
    const bytes = new TextEncoder().encode('हिन्दी');
    const stream = countedStream([bytes.slice(0, 2), bytes.slice(2)]);

    const result = await safeFetch('http://example.com/utf8', {
      fetchImpl: async () => stream.response,
      resolver: publicResolver,
      maxBytes: 1024,
    });

    expect(result.body).toBe('हिन्दी');
    expect(result.body).not.toContain('\uFFFD');
  });

  it('treats a bodyless response as empty rather than as an error', async () => {
    const result = await safeFetch('http://example.com/empty', {
      fetchImpl: async () => new Response(null, { status: 204 }),
      resolver: publicResolver,
    });

    expect(result.body).toBe('');
    expect(result.truncated).toBe(false);
  });
});
