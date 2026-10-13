import { describe, expect, it } from 'vitest';
import {
  assertFetchable,
  assertPublicHost,
  assertSafeUrlSyntax,
  classifyAddress,
  defaultResolver,
  SsrfBlockedError,
  type Resolver,
} from './ssrf.js';

/** A resolver that always returns fixed addresses, so the rules are testable. */
const resolverReturning =
  (...addresses: string[]): Resolver =>
  async () => ({ addresses });

describe('classifyAddress', () => {
  describe('blocks loopback', () => {
    it.each(['127.0.0.1', '127.0.0.53', '127.1.2.3', '127.255.255.254', '::1', '0:0:0:0:0:0:0:1'])(
      '%s',
      (address) => {
        expect(classifyAddress(address)).toEqual({ allowed: false, reason: 'loopback_address' });
      },
    );
  });

  describe('blocks the cloud metadata service', () => {
    it('blocks 169.254.169.254', () => {
      expect(classifyAddress('169.254.169.254')).toEqual({
        allowed: false,
        reason: 'link_local_address',
      });
    });

    it('blocks the whole link-local range', () => {
      expect(classifyAddress('169.254.0.1')).toEqual({
        allowed: false,
        reason: 'link_local_address',
      });
      expect(classifyAddress('fe80::1')).toEqual({
        allowed: false,
        reason: 'link_local_address',
      });
    });
  });

  describe('blocks private networks', () => {
    it.each([
      '10.0.0.1',
      '10.255.255.254',
      '192.168.1.1',
      '192.168.255.255',
      '172.16.0.1',
      '172.31.255.254',
    ])('%s', (address) => {
      expect(classifyAddress(address)).toEqual({ allowed: false, reason: 'private_address' });
    });

    it('blocks unique-local IPv6', () => {
      expect(classifyAddress('fd00::1')).toEqual({ allowed: false, reason: 'private_address' });
      expect(classifyAddress('fc00::1')).toEqual({ allowed: false, reason: 'private_address' });
    });

    it('does not block 172.32.x.x, which is outside RFC1918', () => {
      expect(classifyAddress('172.32.0.1')).toEqual({ allowed: true });
    });

    it('does not block 192.169.x.x', () => {
      expect(classifyAddress('192.169.0.1')).toEqual({ allowed: true });
    });
  });

  it('blocks carrier-grade NAT', () => {
    expect(classifyAddress('100.64.0.1')).toEqual({ allowed: false, reason: 'cgnat_address' });
    expect(classifyAddress('100.127.255.254')).toEqual({ allowed: false, reason: 'cgnat_address' });
  });

  it('does not block 100.128.x.x, which is outside the CGNAT range', () => {
    expect(classifyAddress('100.128.0.1')).toEqual({ allowed: true });
  });

  it('blocks the unspecified address', () => {
    expect(classifyAddress('0.0.0.0')).toEqual({ allowed: false, reason: 'unspecified_address' });
  });

  it('blocks multicast and reserved space', () => {
    expect(classifyAddress('224.0.0.1')).toEqual({ allowed: false, reason: 'private_address' });
    expect(classifyAddress('255.255.255.255')).toEqual({
      allowed: false,
      reason: 'private_address',
    });
  });

  it('catches an IPv4-mapped IPv6 address that points at loopback', () => {
    // ::ffff:127.0.0.1 reaches the same socket as 127.0.0.1.
    expect(classifyAddress('::ffff:127.0.0.1')).toEqual({
      allowed: false,
      reason: 'loopback_address',
    });
  });

  it('catches an IPv4-mapped IPv6 address pointing at the metadata service', () => {
    expect(classifyAddress('::ffff:169.254.169.254')).toEqual({
      allowed: false,
      reason: 'link_local_address',
    });
  });

  it('blocks an IPv4-mapped public address rather than silently allowing it', () => {
    // The dual-stack path is a known way to slip past a literal check, so it is
    // refused even though the address itself is public.
    expect(classifyAddress('::ffff:93.184.216.34')).toEqual({
      allowed: false,
      reason: 'ipv6_transition',
    });
  });

  describe('allows genuinely public addresses', () => {
    it.each([
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '172.32.0.1',
      '192.169.0.1',
      '100.128.0.1',
      '2606:4700:4700::1111',
    ])('%s', (address) => {
      expect(classifyAddress(address)).toEqual({ allowed: true });
    });
  });

  it('refuses anything that is not an IP address', () => {
    expect(classifyAddress('example.com')).toEqual({ allowed: false, reason: 'invalid_url' });
    expect(classifyAddress('')).toEqual({ allowed: false, reason: 'invalid_url' });
  });
});

describe('assertSafeUrlSyntax', () => {
  it('accepts http and https', () => {
    expect(assertSafeUrlSyntax('http://example.com/').protocol).toBe('http:');
    expect(assertSafeUrlSyntax('https://example.com/').protocol).toBe('https:');
  });

  it('rejects a non-http scheme', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/',
      'gopher://example.com/',
      'data:text/html,<h1>hi</h1>',
      'javascript:alert(1)',
      'mailto:hello@example.com',
    ]) {
      expect(() => assertSafeUrlSyntax(url), url).toThrow(SsrfBlockedError);
      expect(() => assertSafeUrlSyntax(url), url).toThrow(/Only http and https/);
    }
  });

  it('rejects an unparseable url', () => {
    expect(() => assertSafeUrlSyntax('http://')).toThrow(SsrfBlockedError);
    expect(() => assertSafeUrlSyntax('not a url at all')).toThrow(/not a valid URL/);
  });

  it('carries the reason on the error', () => {
    try {
      assertSafeUrlSyntax('ftp://example.com/');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SsrfBlockedError);
      expect((error as SsrfBlockedError).reason).toBe('unsupported_scheme');
    }
  });
});

describe('assertPublicHost', () => {
  it('allows a host that resolves to a public address', async () => {
    const url = new URL('https://example.com/');
    const addresses = await assertPublicHost(url, resolverReturning('93.184.216.34'));
    expect(addresses).toEqual(['93.184.216.34']);
  });

  it('blocks a public hostname that resolves to loopback', async () => {
    // The classic bypass: the name looks public, the address is not.
    const url = new URL('https://evil.example.com/');
    await expect(assertPublicHost(url, resolverReturning('127.0.0.1'))).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('blocks when any one of several addresses is private', async () => {
    // DNS rebinding shape: one public answer, one private answer.
    const url = new URL('https://rebind.example.com/');
    await expect(
      assertPublicHost(url, resolverReturning('93.184.216.34', '169.254.169.254')),
    ).rejects.toThrow(/metadata service/);
  });

  it('reports a resolution failure as dns_failure', async () => {
    const url = new URL('https://nonexistent.example/');
    const failing: Resolver = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertPublicHost(url, failing)).rejects.toThrow(/could not be resolved/);
  });

  it('treats an empty resolver result as a failure', async () => {
    const url = new URL('https://empty.example/');
    await expect(assertPublicHost(url, async () => ({ addresses: [] }))).rejects.toThrow(
      SsrfBlockedError,
    );
  });
});

describe('assertFetchable', () => {
  it('returns the url and pinned addresses for a safe host', async () => {
    const result = await assertFetchable(
      'https://example.com/page',
      resolverReturning('93.184.216.34'),
    );
    expect(result.url.href).toBe('https://example.com/page');
    expect(result.addresses).toEqual(['93.184.216.34']);
  });

  it('blocks before resolving when the scheme is wrong', async () => {
    let resolved = false;
    const spy: Resolver = async () => {
      resolved = true;
      return { addresses: ['93.184.216.34'] };
    };

    await expect(assertFetchable('file:///etc/passwd', spy)).rejects.toThrow(SsrfBlockedError);
    // The scheme check must run first, so no DNS lookup happens for it.
    expect(resolved).toBe(false);
  });

  it('blocks a literal loopback url', async () => {
    await expect(assertFetchable('http://127.0.0.1:8787/api/health')).rejects.toThrow(/loopback/);
  });

  it('blocks the metadata ip written directly', async () => {
    await expect(assertFetchable('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /metadata service/,
    );
  });

  it('does not need dns for an address literal', async () => {
    // defaultResolver short-circuits literals, so this must not hit the network.
    const result = await assertFetchable('https://93.184.216.34/');
    expect(result.addresses).toEqual(['93.184.216.34']);
  });
});

describe('defaultResolver', () => {
  it('returns the literal for an address with no lookup', async () => {
    expect(await defaultResolver('8.8.8.8')).toEqual({ addresses: ['8.8.8.8'] });
    expect(await defaultResolver('2606:4700:4700::1111')).toEqual({
      addresses: ['2606:4700:4700::1111'],
    });
  });
});
