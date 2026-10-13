import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Deterministic HTML checks.
 *
 * These run against the homepage only, with a real HTML parser rather than
 * regexes, because a regex over markup is how "no tel link" ends up reported
 * for a page that has one inside a comment or an attribute.
 *
 * Every check returns the value it measured alongside the verdict, so the
 * drafting layer can allowlist that exact number and the UI can show the user
 * what was actually observed.
 */

export interface CheckResult {
  id: string;
  passed: boolean;
  /** The measured value, when there is one to show. */
  value?: string | number | boolean;
  /** What counts as passing, written for a human. */
  threshold?: string;
  detail?: string;
}

/**
 * Build a CheckResult, omitting absent optional keys.
 *
 * `exactOptionalPropertyTypes` is on, so `{ detail: undefined }` is not the
 * same as omitting `detail`. Spreading through this helper keeps every check
 * site readable without widening the type to allow explicit undefined.
 */
function check(
  id: string,
  passed: boolean,
  extras: { value?: string | number | boolean; threshold?: string; detail?: string },
): CheckResult {
  return {
    id,
    passed,
    ...(extras.value !== undefined ? { value: extras.value } : {}),
    ...(extras.threshold !== undefined ? { threshold: extras.threshold } : {}),
    ...(extras.detail !== undefined ? { detail: extras.detail } : {}),
  };
}

export interface HtmlCheckInput {
  html: string;
  /** URL the HTML came from, used to resolve relative links. */
  finalUrl: string;
  /** True when the final URL after redirects uses https. */
  https: boolean;
  /** True when the response status was in the 2xx range. */
  reachable: boolean;
}

const WHATSAPP_HOSTS = ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'chat.whatsapp.com'];

function attr(el: HTMLElement, name: string): string | undefined {
  const value = el.getAttribute(name);
  return value === undefined || value === '' ? undefined : value;
}

/** Resolve a possibly-relative href against the page URL. */
function absoluteUrl(href: string, base: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

/** Parse once and share the tree across the checks. */
export function runHtmlChecks(input: HtmlCheckInput): CheckResult[] {
  const root = parse(input.html, {
    lowerCaseTagName: true,
    comment: false,
    blockTextElements: { script: true, noscript: true, style: true, pre: true },
  });

  const metaTags = root.querySelectorAll('meta');
  const anchors = root.querySelectorAll('a');

  return [
    checkReachable(input),
    checkHttps(input),
    checkViewport(metaTags),
    checkTitle(root),
    checkMetaDescription(metaTags),
    checkTapToCall(anchors),
    checkWhatsapp(anchors, input.finalUrl),
    checkMailto(anchors),
  ];
}

function checkReachable(input: HtmlCheckInput): CheckResult {
  return check('reachable', input.reachable, {
    value: input.reachable,
    threshold: 'The page returns a 2xx status.',
  });
}

function checkHttps(input: HtmlCheckInput): CheckResult {
  const https = input.finalUrl.startsWith('https://');
  return check('https', input.https && https, {
    value: https ? 'https' : 'http',
    threshold: 'The page is served over HTTPS.',
  });
}

function checkViewport(metaTags: HTMLElement[]): CheckResult {
  const viewport = metaTags.find((meta) => (attr(meta, 'name') ?? '').toLowerCase() === 'viewport');
  const content = viewport ? attr(viewport, 'content') : undefined;

  return check('has_viewport', content !== undefined, {
    value: content ?? '',
    threshold: 'A <meta name="viewport"> tag is present.',
    ...(content === undefined ? { detail: 'No viewport meta tag found.' } : {}),
  });
}

/**
 * Titles that carry no information.
 *
 * A site whose title is just "Home" or "Welcome" is invisible in search, which
 * is a real problem worth flagging, but a short list is safer than a long one
 * that catches legitimate business names.
 */
const GENERIC_TITLES = new Set(['home', 'welcome', 'index', 'untitled', 'page', 'homepage']);

function checkTitle(root: HTMLElement): CheckResult {
  const text = root.querySelector('title')?.text?.trim() ?? '';

  const present = text !== '';
  const generic = GENERIC_TITLES.has(text.toLowerCase());

  return check('has_title', present && !generic, {
    value: text,
    threshold: 'A specific <title> is present.',
    ...(generic ? { detail: 'The title is a generic word with no business name.' } : {}),
  });
}

function checkMetaDescription(metaTags: HTMLElement[]): CheckResult {
  const tag = metaTags.find((meta) => (attr(meta, 'name') ?? '').toLowerCase() === 'description');
  const text = (tag ? attr(tag, 'content') : undefined)?.trim() ?? '';

  return check('has_meta_description', text !== '', {
    value: text,
    threshold: 'A non-empty meta description is present.',
  });
}

/** A `tel:` link is what makes a phone number actionable on a phone. */
function checkTapToCall(anchors: HTMLElement[]): CheckResult {
  const telHrefs: string[] = [];

  for (const anchor of anchors) {
    const href = attr(anchor, 'href');
    if (href && href.trim().toLowerCase().startsWith('tel:')) {
      telHrefs.push(href.replace(/^tel:/i, '').trim());
    }
  }

  return check('has_tap_to_call', telHrefs.length > 0, {
    value: telHrefs[0] ?? '',
    threshold: 'At least one <a href="tel:..."> link is present.',
    ...(telHrefs.length > 1 ? { detail: `${telHrefs.length} tap-to-call links found.` } : {}),
  });
}

function checkWhatsapp(anchors: HTMLElement[], finalUrl: string): CheckResult {
  for (const anchor of anchors) {
    const href = attr(anchor, 'href');
    if (!href) continue;

    const absolute = absoluteUrl(href, finalUrl);
    if (!absolute) continue;

    let host: string;
    try {
      host = new URL(absolute).hostname.toLowerCase();
    } catch {
      continue;
    }

    if (WHATSAPP_HOSTS.includes(host) || absolute.toLowerCase().startsWith('whatsapp:')) {
      return check('has_whatsapp_link', true, {
        value: host,
        threshold: 'A WhatsApp link is present.',
      });
    }
  }

  return check('has_whatsapp_link', false, {
    value: '',
    threshold: 'A link to wa.me or api.whatsapp.com is present.',
  });
}

/**
 * The only source of a lead's contact email.
 *
 * A `mailto:` read here came from the business's own site, which is what makes
 * storing it defensible. Nothing else in the app may write this field.
 */
export interface MailtoResult extends CheckResult {
  address: string | undefined;
}

/** No base URL is needed: a mailto: href is absolute by definition. */
function checkMailto(anchors: HTMLElement[]): MailtoResult {
  const threshold = 'A public mailto: address is present on the site.';

  for (const anchor of anchors) {
    const href = attr(anchor, 'href');
    if (!href || !href.trim().toLowerCase().startsWith('mailto:')) continue;

    const address = href
      .replace(/^mailto:/i, '')
      .split('?')[0]
      ?.split(',')[0]
      ?.trim();

    if (address && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      return { ...check('has_public_email', true, { value: address, threshold }), address };
    }
  }

  return { ...check('has_public_email', false, { value: '', threshold }), address: undefined };
}

/** Extract the public contact email, if the checks found one. */
export function findPublicEmail(checks: CheckResult[]): string | undefined {
  const found = checks.find((entry) => entry.id === 'has_public_email');
  const address = (found as MailtoResult | undefined)?.address;
  return address !== undefined && address !== '' ? address : undefined;
}
