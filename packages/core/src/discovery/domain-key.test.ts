import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  computeDomainKey,
  hasRealWebsite,
  isSocialOrDirectory,
} from './domain-key.js';

describe('computeDomainKey', () => {
  it('extracts the host from a normal site', () => {
    expect(computeDomainKey('https://sharmaplumbing.in/')).toBe('sharmaplumbing.in');
  });

  it('strips a leading www', () => {
    expect(computeDomainKey('https://www.sharmaplumbing.in/')).toBe('sharmaplumbing.in');
  });

  it('keeps a subdomain that carries identity', () => {
    expect(computeDomainKey('https://shop.vermaelectric.com/')).toBe('shop.vermaelectric.com');
  });

  it('handles a missing scheme', () => {
    expect(computeDomainKey('sharmaplumbing.in')).toBe('sharmaplumbing.in');
  });

  it('ignores path, query and fragment', () => {
    expect(computeDomainKey('https://example.com/menu?table=4#top')).toBe('example.com');
  });

  it('strips a port', () => {
    expect(computeDomainKey('http://localhost:8080')).toBe('localhost');
  });

  it('lowercases the host', () => {
    expect(computeDomainKey('https://EXAMPLE.com/')).toBe('example.com');
  });

  it('decodes an internationalized domain', () => {
    expect(computeDomainKey('https://münchen.example/x')).toBe('xn--mnchen-3ya.example');
  });

  describe('returns undefined when there is no real website', () => {
    it('for a facebook page', () => {
      expect(computeDomainKey('https://www.facebook.com/sharmaplumbing')).toBeUndefined();
      expect(computeDomainKey('https://m.facebook.com/sharmaplumbing')).toBeUndefined();
      expect(computeDomainKey('https://facebook.com/sharmaplumbing')).toBeUndefined();
    });

    it('for an instagram profile', () => {
      expect(computeDomainKey('https://instagram.com/vermaelectric')).toBeUndefined();
    });

    it('for a directory listing', () => {
      expect(computeDomainKey('https://www.justdial.com/Bhopal/Plumbers/123456')).toBeUndefined();
      expect(computeDomainKey('https://sulekha.com/plumbers-bhopal/')).toBeUndefined();
      expect(computeDomainKey('https://www.indiamart.com/verma-electric/')).toBeUndefined();
    });

    it('for a link-in-bio page', () => {
      expect(computeDomainKey('https://linktr.ee/vermaelectric')).toBeUndefined();
      expect(computeDomainKey('https://beacons.ai/vermaelectric')).toBeUndefined();
    });

    it('for a google business profile url', () => {
      expect(computeDomainKey('https://g.page/sharmaplunting')).toBeUndefined();
      expect(computeDomainKey('https://maps.app.goo.gl/abc123')).toBeUndefined();
    });

    it('for a non-http scheme', () => {
      expect(computeDomainKey('mailto:hello@example.com')).toBeUndefined();
      expect(computeDomainKey('javascript:alert(1)')).toBeUndefined();
      expect(computeDomainKey('ftp://example.com')).toBeUndefined();
    });

    it('for empty or malformed input', () => {
      expect(computeDomainKey('')).toBeUndefined();
      expect(computeDomainKey('   ')).toBeUndefined();
      expect(computeDomainKey(undefined)).toBeUndefined();
      expect(computeDomainKey(null)).toBeUndefined();
      expect(computeDomainKey('http://')).toBeUndefined();
    });
  });

  it('does not mistake a subdomain of a social host for a real site', () => {
    // A business subdomain on a social domain is still a social page.
    expect(computeDomainKey('https://shop.facebook.com/verma')).toBeUndefined();
  });

  it('does not treat a lookalike host as a social host', () => {
    expect(computeDomainKey('https://notfacebook.com/')).toBe('notfacebook.com');
    expect(computeDomainKey('https://facebook.example.com/')).toBe('facebook.example.com');
  });
});

describe('isSocialOrDirectory', () => {
  it('detects a social host directly', () => {
    expect(isSocialOrDirectory('facebook.com')).toBe(true);
    expect(isSocialOrDirectory('LINKTR.EE')).toBe(true);
  });

  it('detects a social subdomain', () => {
    expect(isSocialOrDirectory('m.facebook.com')).toBe(true);
  });

  it('leaves a real site alone', () => {
    expect(isSocialOrDirectory('sharmaplumbing.in')).toBe(false);
  });
});

describe('hasRealWebsite', () => {
  it('is false for a social page and true for a site', () => {
    expect(hasRealWebsite('https://facebook.com/x')).toBe(false);
    expect(hasRealWebsite('https://sharmaplumbing.in')).toBe(true);
    expect(hasRealWebsite(undefined)).toBe(false);
  });
});

describe('canonicalizeUrl', () => {
  it('collapses scheme, www and trailing slash', () => {
    expect(canonicalizeUrl('http://www.example.com/')).toBe('example.com');
    expect(canonicalizeUrl('https://example.com/')).toBe('example.com');
  });

  it('keeps a meaningful path', () => {
    expect(canonicalizeUrl('https://example.com/menu/')).toBe('example.com/menu');
  });

  it('drops tracking parameters', () => {
    expect(canonicalizeUrl('https://example.com/menu?utm_source=x&gclid=y&table=4')).toBe(
      'example.com/menu?table=4',
    );
  });

  it('orders remaining parameters so equivalent URLs match', () => {
    expect(canonicalizeUrl('https://example.com/?b=2&a=1')).toBe(
      canonicalizeUrl('https://example.com/?a=1&b=2'),
    );
  });

  it('returns undefined for unusable input', () => {
    expect(canonicalizeUrl('')).toBeUndefined();
  });
});
