// The `max` metadata bundle, not the default one.
//
// The default build carries just enough to validate a number, and `getType()`
// returns undefined for most Indian numbers with it. Since deciding whether to
// offer WhatsApp is exactly what this module is for, the type patterns are not
// optional: with the default bundle `+91 98123 45678` reports no type at all
// and every Indian mobile would look like a landline.
import {
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumber,
} from 'libphonenumber-js/max';

/**
 * Phone normalization.
 *
 * A lead's phone number decides whether Localscout can offer WhatsApp at all, so
 * the rules here are conservative:
 *
 * - Normalize to E.164 using the configured default country, because listings
 *   mix local formats ("098123 45678") with international ones.
 * - Only report `isMobile` when the number type is genuinely mobile. Offering a
 *   WhatsApp link for a landline produces a message that goes nowhere, which
 *   reads as a bug to the business owner.
 * - Never guess a country. A number that cannot be resolved stays unnormalized
 *   rather than being forced into a plausible-looking wrong number.
 */

export interface NormalizedPhone {
  /** The input, trimmed, when it could not be normalized. */
  raw: string;
  /** E.164 form, or undefined when the number could not be resolved. */
  e164: string | undefined;
  /** True only when the number type is mobile or a mobile-specific service. */
  isMobile: boolean;
  /** Type as libphonenumber-js classifies it, for debugging and display. */
  type: string | undefined;
}

const EMPTY: NormalizedPhone = { raw: '', e164: undefined, isMobile: false, type: undefined };

/** Strip the visual separators humans add but the parser does not tolerate. */
function tidy(input: string): string {
  // \s covers the non-breaking spaces that creep into copied phone numbers.
  return input.replace(/\s+/g, ' ').trim();
}

export function normalizePhone(input: string | undefined, defaultCountry: string): NormalizedPhone {
  if (input === undefined || input === null) return EMPTY;

  const raw = tidy(input);
  if (raw === '') return EMPTY;

  const country = defaultCountry.toUpperCase() as CountryCode;
  const parsed = parsePhoneNumberFromString(raw, country);

  if (!parsed) {
    // Keep the raw text so a human can still read and dial it by hand, but do
    // not claim a number we could not verify.
    return { raw, e164: undefined, isMobile: false, type: undefined };
  }

  // Parsed but not valid: the digits exist but do not form a dialable number
  // ("12345" becomes "+9112345"). Emitting that as E.164 would put a number we
  // know to be wrong into a WhatsApp link, so the raw text is kept for a human
  // and the normalized fields stay empty.
  if (!parsed.isValid()) {
    return { raw, e164: undefined, isMobile: false, type: undefined };
  }

  return {
    raw,
    e164: parsed.format('E.164'),
    isMobile: isMobileNumber(parsed),
    type: parsed.getType() ?? undefined,
  };
}

/**
 * Whether WhatsApp can be offered for this number.
 *
 * `FIXED_LINE_OR_MOBILE` counts as mobile. In the Indian numbering plan those
 * ranges are allocated to mobile operators, and libphonenumber-js reports the
 * ambiguity rather than guessing; refusing to offer WhatsApp there would drop
 * a large share of exactly the small businesses this tool targets. VOIP is
 * accepted for the same reason: plenty of small firms run WhatsApp Business on
 * one, and the downside is a message going unread, not a privacy problem.
 *
 * Toll-free and plain fixed lines are excluded.
 */
function isMobileNumber(parsed: PhoneNumber): boolean {
  // `getType()` returns UPPERCASE strings ('MOBILE', 'FIXED_LINE_OR_MOBILE'),
  // not the lowercase enum names the type declares. Comparing against lowercase
  // is silently always false, which would mark every Indian mobile as a landline
  // and hide WhatsApp from every lead. The uppercase constants below are what
  // the library actually returns; `phone.test.ts` pins this.
  const type = parsed.getType();
  return type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE' || type === 'VOIP';
}

/**
 * Strip formatting for a WhatsApp deep link.
 *
 * `https://wa.me/<digits>` takes the number without a `+` and without spaces,
 * which is why this is separate from E.164 formatting.
 */
export function whatsappDigits(e164: string | undefined): string | undefined {
  if (!e164) return undefined;
  const digits = e164.replace(/\D/g, '');
  // WhatsApp links are country code plus subscriber number; anything shorter
  // than eight digits is not a usable international number.
  return digits.length >= 8 ? digits : undefined;
}

/** Build the click-to-chat URL with the message prefilled. */
export function whatsappLink(e164: string | undefined, text: string): string | undefined {
  const digits = whatsappDigits(e164);
  if (!digits) return undefined;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
