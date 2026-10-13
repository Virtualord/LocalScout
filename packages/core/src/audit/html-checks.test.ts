import { describe, expect, it } from 'vitest';
import { findPublicEmail, runHtmlChecks } from './html-checks.js';

const BASE = 'https://sharmaplumbing.in/';

const goodHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Emergency plumbing in Bhopal.">
  <title>Sharma Plumbing Works | Plumbers in Bhopal</title>
</head>
<body>
  <a href="tel:+919812345678">Call</a>
  <a href="https://wa.me/919812345678">WhatsApp</a>
  <a href="mailto:hello@sharmaplumbing.in">Email</a>
</body>
</html>`;

const run = (html: string, overrides: Partial<Parameters<typeof runHtmlChecks>[0]> = {}) =>
  runHtmlChecks({ html, finalUrl: BASE, https: true, reachable: true, ...overrides });

const byId = (checks: ReturnType<typeof runHtmlChecks>, id: string) =>
  checks.find((check) => check.id === id);

describe('html checks', () => {
  it('passes every check on a healthy site', () => {
    const checks = run(goodHtml);
    const failing = checks.filter((check) => !check.passed).map((check) => check.id);
    expect(failing).toEqual([]);
    expect(checks).toHaveLength(8);
  });

  describe('reachability and https', () => {
    it('fails reachability on a non-2xx status', () => {
      expect(byId(run(goodHtml, { reachable: false }), 'reachable')?.passed).toBe(false);
    });

    it('fails https when the final url is http', () => {
      const checks = run(goodHtml, { https: false, finalUrl: 'http://sharmaplumbing.in/' });
      expect(byId(checks, 'https')?.passed).toBe(false);
      expect(byId(checks, 'https')?.value).toBe('http');
    });

    it('reports the scheme actually used', () => {
      expect(byId(run(goodHtml), 'https')?.value).toBe('https');
    });
  });

  describe('viewport', () => {
    it('detects a viewport tag regardless of case or spacing', () => {
      const html =
        '<html><head><meta NAME="viewport" content="width=device-width"></head><body></body></html>';
      expect(byId(run(html), 'has_viewport')?.passed).toBe(true);
    });

    it('fails when the viewport tag is absent', () => {
      const check = byId(run('<html><head><title>x</title></head></html>'), 'has_viewport');
      expect(check?.passed).toBe(false);
      expect(check?.detail).toContain('No viewport');
    });

    it('does not confuse a content meta for a viewport meta', () => {
      const html =
        '<html><head><meta name="description" content="width=device-width"></head></html>';
      expect(byId(run(html), 'has_viewport')?.passed).toBe(false);
    });
  });

  describe('title', () => {
    it('accepts a specific title', () => {
      expect(byId(run(goodHtml), 'has_title')?.passed).toBe(true);
    });

    it('fails on a missing title', () => {
      expect(byId(run('<html><head></head><body>x</body></html>'), 'has_title')?.passed).toBe(
        false,
      );
    });

    it('fails on an empty title', () => {
      expect(byId(run('<html><head><title>   </title></head></html>'), 'has_title')?.passed).toBe(
        false,
      );
    });

    it('fails on a generic title', () => {
      for (const generic of ['Home', 'welcome', 'Index', 'Untitled', 'Homepage']) {
        const check = byId(run(`<html><head><title>${generic}</title></head></html>`), 'has_title');
        expect(check?.passed, generic).toBe(false);
      }
    });

    it('accepts a title that merely contains a generic word', () => {
      const html = '<html><head><title>Home Services Bhopal</title></head></html>';
      expect(byId(run(html), 'has_title')?.passed).toBe(true);
    });
  });

  describe('meta description', () => {
    it('fails when absent', () => {
      expect(
        byId(run(goodHtml.replace(/<meta name="description"[^>]*>/, '')), 'has_meta_description')
          ?.passed,
      ).toBe(false);
    });

    it('fails when empty or whitespace', () => {
      const html = '<html><head><meta name="description" content="   "></head></html>';
      expect(byId(run(html), 'has_meta_description')?.passed).toBe(false);
    });

    it('passes when populated', () => {
      expect(byId(run(goodHtml), 'has_meta_description')?.value).toContain('Emergency plumbing');
    });
  });

  describe('tap to call', () => {
    it('detects a tel link', () => {
      const check = byId(run(goodHtml), 'has_tap_to_call');
      expect(check?.passed).toBe(true);
      expect(check?.value).toBe('+919812345678');
    });

    it('is case insensitive on the scheme', () => {
      expect(
        byId(run('<html><body><a href="TEL:+911234567890">c</a></body></html>'), 'has_tap_to_call')
          ?.passed,
      ).toBe(true);
    });

    it('does not count a phone number written as plain text', () => {
      // The whole point of tap-to-call on a phone.
      expect(
        byId(run('<html><body><p>Call 098123 45678</p></body></html>'), 'has_tap_to_call')?.passed,
      ).toBe(false);
    });

    it('does not count a tel link inside a comment', () => {
      const html = '<html><body><!-- <a href="tel:+911234567890">x</a> --></body></html>';
      expect(byId(run(html), 'has_tap_to_call')?.passed).toBe(false);
    });

    it('counts multiple links', () => {
      const html = '<html><body><a href="tel:111">a</a><a href="tel:222">b</a></body></html>';
      expect(byId(run(html), 'has_tap_to_call')?.detail).toContain('2 tap-to-call');
    });
  });

  describe('whatsapp link', () => {
    it('detects wa.me', () => {
      expect(byId(run(goodHtml), 'has_whatsapp_link')?.passed).toBe(true);
    });

    it('detects api.whatsapp.com', () => {
      const html =
        '<html><body><a href="https://api.whatsapp.com/send?phone=919812345678">wa</a></body></html>';
      expect(byId(run(html), 'has_whatsapp_link')?.passed).toBe(true);
    });

    it('fails when absent', () => {
      expect(
        byId(run('<html><body><a href="/contact">c</a></body></html>'), 'has_whatsapp_link')
          ?.passed,
      ).toBe(false);
    });

    it('does not match a lookalike host', () => {
      const html = '<html><body><a href="https://notwa.me.example/x">x</a></body></html>';
      expect(byId(run(html), 'has_whatsapp_link')?.passed).toBe(false);
    });
  });

  describe('public email', () => {
    it('extracts a mailto address', () => {
      const checks = run(goodHtml);
      expect(byId(checks, 'has_public_email')?.passed).toBe(true);
      expect(findPublicEmail(checks)).toBe('hello@sharmaplumbing.in');
    });

    it('strips query parameters from the address', () => {
      const html =
        '<html><body><a href="mailto:hi@example.com?subject=Book%20now">e</a></body></html>';
      expect(findPublicEmail(run(html))).toBe('hi@example.com');
    });

    it('ignores a malformed address', () => {
      const html = '<html><body><a href="mailto:not-an-email">e</a></body></html>';
      expect(findPublicEmail(run(html))).toBeUndefined();
    });

    it('returns undefined when there is no mailto', () => {
      expect(findPublicEmail(run('<html><body>hi@example.com</body></html>'))).toBeUndefined();
    });

    it('does not treat visible text as a published address', () => {
      // Only a mailto: link counts. Text on the page is not consent to store.
      const html = '<html><body><p>Email us at hello@example.com</p></body></html>';
      expect(findPublicEmail(run(html))).toBeUndefined();
    });
  });

  it('handles an empty document without throwing', () => {
    const checks = run('');
    expect(checks).toHaveLength(8);
    expect(checks.filter((c) => c.passed).length).toBeGreaterThan(0);
  });

  it('survives malformed markup', () => {
    // The guarantee is that a broken page cannot crash an audit run. Exactly how
    // the parser recovers from an unterminated <title> is its business, not
    // ours, so only the absence of a throw is asserted.
    let checks: ReturnType<typeof runHtmlChecks> | undefined;
    expect(() => {
      checks = run('<html><head><title>Broken<body><a href=tel:+911234567890</a>');
    }).not.toThrow();
    expect(checks).toHaveLength(8);
  });

  it('ignores content inside a script tag', () => {
    const html =
      '<html><head><script>document.write(\'<meta name="viewport" content="x">\')</script></head></html>';
    expect(byId(run(html), 'has_viewport')?.passed).toBe(false);
  });
});
