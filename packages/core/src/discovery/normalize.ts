import { normalizePhone, type NormalizedPhone } from '../phone/phone.js';
import { computeDomainKey } from './domain-key.js';

/**
 * The shape discovery produces, independent of SerpApi's response format.
 *
 * Everything here is either something the source stated or something derived
 * from it by a pure rule. There is no field a later step can read that
 * discovery had to guess.
 */
export interface Listing {
  /** Google Maps' stable identifier for this listing. */
  placeId: string;
  name: string;
  category: string | undefined;
  address: string | undefined;
  lat: number | undefined;
  lng: number | undefined;
  phone: string | undefined;
  phoneE164: string | undefined;
  /** True only for a genuinely mobile number, so WhatsApp can be offered. */
  phoneIsMobile: boolean;
  /** The URL exactly as the listing stated it, or undefined. */
  websiteUrl: string | undefined;
  /**
   * Comparable host for dedupe, or undefined when the "website" is a social
   * page, a directory entry, or absent. Undefined is meaningful: it means the
   * business has no site of its own.
   */
  domainKey: string | undefined;
  rating: number | undefined;
  reviewCount: number | undefined;
}

/** The raw SerpApi Google Maps place object, as documented. */
export interface RawPlace {
  position?: number;
  title?: string;
  place_id?: string;
  gps_coordinates?: { latitude?: number; longitude?: number };
  rating?: number;
  reviews?: number;
  type?: string;
  types?: string[];
  address?: string;
  phone?: string;
  website?: string;
  data_id?: string;
}

export interface SerpApiResponse {
  search_metadata?: { status?: string };
  local_results?: RawPlace[];
  search_parameters?: Record<string, unknown>;
}

/**
 * Convert a raw SerpApi response into listings.
 *
 * Entries without a `place_id` or a title are dropped rather than kept with
 * placeholder values: a listing with no identity cannot be deduplicated, and a
 * lead that cannot be deduplicated is how the same business gets pitched twice.
 */
export function normalizeSerpApiResponse(
  response: SerpApiResponse,
  defaultCountry: string,
): Listing[] {
  const places = response.local_results ?? [];
  const listings: Listing[] = [];

  for (const place of places) {
    const listing = normalizePlace(place, defaultCountry);
    if (listing) listings.push(listing);
  }

  return listings;
}

/** Normalize one place, or return undefined when it cannot be identified. */
export function normalizePlace(place: RawPlace, defaultCountry: string): Listing | undefined {
  const placeId = clean(place.place_id);
  const name = clean(place.title);
  if (!placeId || !name) return undefined;

  const phone: NormalizedPhone = normalizePhone(clean(place.phone), defaultCountry);
  const websiteUrl = clean(place.website);

  return {
    placeId,
    name,
    category: clean(place.type) ?? clean(place.types?.[0]),
    address: clean(place.address),
    lat: finiteNumber(place.gps_coordinates?.latitude),
    lng: finiteNumber(place.gps_coordinates?.longitude),
    phone: clean(place.phone),
    phoneE164: phone.e164,
    phoneIsMobile: phone.isMobile,
    websiteUrl,
    domainKey: computeDomainKey(websiteUrl),
    rating: finiteNumber(place.rating),
    reviewCount: finiteNumber(place.reviews),
  };
}

/** Trim to a non-empty string, or undefined. */
function clean(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Coerce a JSON value that should be a number.
 *
 * SerpApi occasionally sends a numeric field as a string. Anything that is not a
 * finite number becomes undefined rather than NaN, because NaN in a metric
 * would surface as a fabricated value in the UI.
 */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
