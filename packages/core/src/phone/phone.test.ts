import { describe, expect, it } from 'vitest';
import { normalizePhone, whatsappDigits, whatsappLink } from './phone.js';

describe('normalizePhone', () => {
  it('normalizes an Indian mobile number to E.164', () => {
    const result = normalizePhone('+91 98123 45678', 'IN');
    expect(result.e164).toBe('+919812345678');
    expect(result.isMobile).toBe(true);
    // getType() returns uppercase strings, not the lowercase enum names.
    expect(result.type).toBe('MOBILE');
  });

  it('normalizes a national format number using the default country', () => {
    expect(normalizePhone('098123 45678', 'IN').e164).toBe('+919812345678');
  });

  it('normalizes a number with punctuation and spacing', () => {
    expect(normalizePhone('+91-98123-45678', 'IN').e164).toBe('+919812345678');
  });

  it('keeps the raw text when the number cannot be resolved', () => {
    const result = normalizePhone('not a phone number', 'IN');
    expect(result.e164).toBeUndefined();
    expect(result.isMobile).toBe(false);
    expect(result.raw).toBe('not a phone number');
  });

  it('does not guess a country for an unparseable number', () => {
    // Without a region a bare subscriber number cannot be placed. Returning
    // nothing is the honest answer.
    const result = normalizePhone('12345', 'IN');
    expect(result.e164).toBeUndefined();
  });

  it('marks an Indian landline as not mobile, so WhatsApp is not offered', () => {
    const result = normalizePhone('+91 121 234 5678', 'IN');
    expect(result.isMobile).toBe(false);
    expect(result.type).toBe('FIXED_LINE');
  });

  it('treats the ambiguous Indian fixed_line_or_mobile range as mobile', () => {
    // libphonenumber-js reports FIXED_LINE_OR_MOBILE for this range rather than
    // guessing. In the Indian numbering plan it is allocated to mobile
    // operators, so WhatsApp must be offered.
    const result = normalizePhone('+91 771 234 5678', 'IN');
    expect(result.type).toBe('FIXED_LINE_OR_MOBILE');
    expect(result.isMobile).toBe(true);
  });

  it('excludes an Indian toll-free number', () => {
    const result = normalizePhone('+91 1800 123 456', 'IN');
    expect(result.type).toBe('TOLL_FREE');
    expect(result.isMobile).toBe(false);
  });

  it('marks a US toll-free number as not mobile', () => {
    const result = normalizePhone('+1 800 555 0199', 'US');
    expect(result.type).toBe('TOLL_FREE');
    expect(result.isMobile).toBe(false);
  });

  it('treats a VOIP number as usable for WhatsApp', () => {
    // Small businesses often run WhatsApp Business on a VOIP line.
    const result = normalizePhone('+91 90000 12345', 'IN');
    expect(result.type).toBe('MOBILE');
    expect(result.isMobile).toBe(true);
  });

  it('handles an empty or missing input', () => {
    expect(normalizePhone(undefined, 'IN')).toEqual({
      raw: '',
      e164: undefined,
      isMobile: false,
      type: undefined,
    });
    expect(normalizePhone('   ', 'IN').e164).toBeUndefined();
    expect(normalizePhone('', 'IN').raw).toBe('');
  });

  it('preserves the raw text alongside the normalized value', () => {
    const result = normalizePhone('098123 45678', 'IN');
    expect(result.raw).toBe('098123 45678');
    expect(result.e164).toBe('+919812345678');
  });

  it('honours a different default country', () => {
    expect(normalizePhone('07400 123456', 'GB').e164).toBe('+447400123456');
  });

  it('does not treat a plain number as valid when it is too short', () => {
    const result = normalizePhone('123', 'IN');
    expect(result.isMobile).toBe(false);
  });
});

describe('whatsappDigits', () => {
  it('strips the plus sign', () => {
    expect(whatsappDigits('+919812345678')).toBe('919812345678');
  });

  it('rejects a number that is too short to dial internationally', () => {
    expect(whatsappDigits('+9112')).toBeUndefined();
  });

  it('returns undefined for no number', () => {
    expect(whatsappDigits(undefined)).toBeUndefined();
  });
});

describe('whatsappLink', () => {
  it('builds a click-to-chat link with the message encoded', () => {
    const link = whatsappLink('+919812345678', 'Hello & welcome');
    expect(link).toBe('https://wa.me/919812345678?text=Hello%20%26%20welcome');
  });

  it('returns undefined for a number WhatsApp cannot use', () => {
    expect(whatsappLink(undefined, 'Hello')).toBeUndefined();
  });

  it('encodes newlines and emoji safely', () => {
    const link = whatsappLink('+919812345678', 'Line one\nLine two 👍');
    expect(link).toBe('https://wa.me/919812345678?text=Line%20one%0ALine%20two%20%F0%9F%91%8D');
  });
});
