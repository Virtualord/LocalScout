import type { StoredFinding } from '../db/schema.js';
import {
  DEFAULT_BANNED_PHRASES,
  DRAFT_LIMITS,
  type DraftOutput,
  type GroundingOptions,
  type ValidationError,
  type ValidationResult,
} from './provider.js';

/**
 * The grounding validator.
 *
 * This is the reason a Localscout draft can be trusted. The model is told to
 * use only the facts it was given, and then every draft is checked against the
 * recorded audit anyway: a prompt instruction is a request, not a guarantee,
 * and a 4B model will cheerfully write "5x more leads" into a message to a
 * stranger.
 *
 * Four things are rejected:
 *
 * 1. **Citations of findings that do not exist.** `used_finding_ids` must be a
 *    subset of the findings the audit actually produced.
 * 2. **Numbers nothing measured.** Every number in the text is extracted and
 *    checked against an allowlist built from the audit's own evidence values, in
 *    every rendering a model plausibly uses ("6100", "6.1", "6,100").
 * 3. **URLs that are neither the lead's own site nor the sender's portfolio.**
 *    A model that invents a portfolio link is sending someone to the wrong
 *    person's work.
 * 4. **Banned phrases and over-long messages.**
 *
 * Pure and heavily tested: no I/O, no clock, no randomness.
 */

export interface GroundingContext {
  /** Findings the audit actually produced. */
  findings: StoredFinding[];
  /** The lead's own website, when it has one. */
  websiteUrl?: string | undefined;
  /** The sender's portfolio, which is allowed to appear. */
  portfolioUrl?: string | undefined;
  /** The lead's phone, allowed to appear as written in the message. */
  phoneE164?: string | undefined;
  /**
   * Extra numeric strings the template is allowed to use.
   *
   * For example a rating the listing reported, which is a real measured value
   * but is not part of the audit findings.
   */
  allowedNumbers?: readonly string[];
}

/** Numbers that may appear regardless of the audit, because they are not claims. */
const UNIVERSALLY_ALLOWED = new Set([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '100',
  '24',
  '7',
]);

/**
 * Extract numeric tokens from free text.
 *
 * Handles thousands separators, decimal points, percent signs, and the
 * `6.1s` / `2.4MB` forms a model uses when it is being concise. Percentages and
 * durations are normalized by stripping the unit before comparison.
 */
export function extractNumbers(text: string): string[] {
  // Matches 6,100.5 / 6100 / 6.1 / 38% / 0.31 with an optional trailing unit.
  const pattern = /\d[\d,]*(?:\.\d+)?/g;
  const found = text.match(pattern) ?? [];

  return found.map((token) => {
    const normalized = token.replace(/,/g, '');
    const asNumber = Number(normalized);
    if (!Number.isFinite(asNumber)) return normalized;
    // Keep integers integral, and drop trailing zeros from decimals so 0.30
    // and 0.3 compare equal.
    return Number.isInteger(asNumber) ? String(asNumber) : String(parseFloat(normalized));
  });
}

/** Every way a measured value might legitimately be written in a message. */
function renderings(value: number | string | boolean): string[] {
  if (typeof value === 'boolean') return [];
  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? renderings(numeric) : [];
  }

  const forms = new Set<string>();
  forms.add(String(value));

  // Seconds rendering of a millisecond measurement: 6100 ms -> "6.1".
  if (Number.isInteger(value) && value >= 100) {
    forms.add((value / 1000).toFixed(1));
    forms.add((value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  }

  // One decimal place of any number: 38 -> 38.0, 0.31 -> 0.3.
  forms.add(value.toFixed(1));
  // Thousands separators: 6100 -> 6,100.
  forms.add(value.toLocaleString('en-US'));

  return [...forms];
}

/**
 * Build the allowlist of numbers a draft may state.
 *
 * Built from the audit's own evidence, in the order the evidence objects name
 * their keys, so a value can appear whether the model writes "6100 ms" or "6.1
 * seconds".
 */
export function buildNumberAllowlist(context: GroundingContext): Set<string> {
  const allowed = new Set<string>(UNIVERSALLY_ALLOWED);

  for (const extra of context.allowedNumbers ?? []) {
    allowed.add(extra);
    const numeric = Number(extra);
    if (Number.isFinite(numeric)) {
      for (const form of renderings(numeric)) allowed.add(form);
    }
  }

  for (const finding of context.findings) {
    for (const value of Object.values(finding.evidence)) {
      if (typeof value === 'boolean' || typeof value === 'string') {
        for (const form of renderings(value)) allowed.add(form);
        if (typeof value === 'string') allowed.add(value);
        continue;
      }
      for (const form of renderings(value)) allowed.add(form);
    }
    // A finding's weight is not a user-facing claim, so it is not allowlisted.
  }

  return allowed;
}

/** Collect the hosts a draft is permitted to link to. */
function allowedHosts(context: GroundingContext): Set<string> {
  const hosts = new Set<string>();
  for (const url of [context.websiteUrl, context.portfolioUrl]) {
    if (!url) continue;
    try {
      hosts.add(new URL(url).hostname.toLowerCase().replace(/^www\./, ''));
    } catch {
      // An unparseable configured URL grants no permission.
    }
  }
  return hosts;
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;

/**
 * Validate a draft against the recorded audit.
 *
 * Returns every failure rather than the first, so a single retry can fix them
 * all at once.
 */
export function validateGrounding(
  draft: DraftOutput,
  context: GroundingContext,
  options: GroundingOptions = {},
): ValidationResult {
  const errors: ValidationError[] = [];
  const banned = options.bannedPhrases ?? DEFAULT_BANNED_PHRASES;
  const whatsappMax = options.whatsappMaxChars ?? DRAFT_LIMITS.whatsappMaxChars;
  const emailMaxWords = options.emailMaxWords ?? DRAFT_LIMITS.emailMaxWords;

  // 1. Citations must refer to findings that exist.
  const knownIds = new Set(context.findings.map((finding) => finding.id));
  const unknown = draft.used_finding_ids.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    errors.push({
      code: 'unknown_finding_id',
      message: `Cited findings that do not exist: ${unknown.join(', ')}. Use only ids from the provided findings.`,
    });
  }

  const texts = [draft.whatsapp, draft.email_subject, draft.email_body].filter(
    (text) => text.trim() !== '',
  );

  if (texts.length === 0) {
    errors.push({ code: 'empty_message', message: 'The draft is empty.' });
  }

  // 2. Numbers must be measured.
  const allowlist = buildNumberAllowlist(context);
  for (const text of texts) {
    for (const number of extractNumbers(text)) {
      if (allowlist.has(number)) continue;
      errors.push({
        code: 'invented_number',
        message: `The number "${number}" was not measured. Use only numbers from the provided findings, or omit them.`,
      });
    }
  }

  // 3. URLs must be the lead's own site or the sender's portfolio.
  const hosts = allowedHosts(context);
  for (const text of texts) {
    const found = text.match(URL_PATTERN);
    if (!found) continue;
    for (const raw of found) {
      let hostname: string;
      try {
        hostname = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname
          .toLowerCase()
          .replace(/^www\./, '');
      } catch {
        errors.push({ code: 'foreign_url', message: `"${raw}" is not a valid URL.` });
        continue;
      }
      if (hosts.has(hostname)) continue;
      errors.push({
        code: 'foreign_url',
        message: `The URL "${raw}" is not the lead's website or the sender's portfolio. Do not include other links.`,
      });
    }
  }

  // 4. Banned phrases and length limits.
  for (const text of texts) {
    const lowered = text.toLowerCase();
    for (const phrase of banned) {
      if (lowered.includes(phrase.toLowerCase())) {
        errors.push({
          code: 'banned_phrase',
          message: `The phrase "${phrase}" is not allowed. Make the claim plainly and factually.`,
        });
      }
    }
  }

  if (draft.whatsapp.length > whatsappMax) {
    errors.push({
      code: 'whatsapp_too_long',
      message: `The WhatsApp message is ${draft.whatsapp.length} characters. Keep it under ${whatsappMax}.`,
    });
  }

  const emailWords =
    draft.email_body.trim() === '' ? 0 : draft.email_body.trim().split(/\s+/).length;
  if (emailWords > emailMaxWords) {
    errors.push({
      code: 'email_too_long',
      message: `The email body is ${emailWords} words. Keep it under ${emailMaxWords}.`,
    });
  }

  return { grounded: errors.length === 0, errors };
}
