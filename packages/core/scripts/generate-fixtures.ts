import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generate the recorded SerpApi fixtures.
 *
 * These stand in for live discovery so a fresh clone can run end to end with no
 * API key, and so the audit and draft code can be tested against a realistic
 * response shape. They are synthetic: businesses, place ids and phone numbers
 * are invented for testing, not collected.
 *
 * Run with: pnpm --filter @localscout/core fixtures:generate
 */

/**
 * The mix deliberately present in every recorded city:
 * businesses with no site, businesses whose only "site" is a social or
 * directory page, and businesses with a real domain of varying quality. The
 * audit phase exercises each of these against local fixture sites.
 */

interface SeedBusiness {
  title: string;
  type: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  reviews: number;
  phone: string;
  website?: string;
}

/** Three cities, with a deliberate spread of website conditions per city. */
const CITIES: Record<
  string,
  { lat: number; lng: number; spread: number; businesses: SeedBusiness[] }
> = {
  Bhopal: {
    lat: 23.2599,
    lng: 77.4126,
    spread: 0.035,
    businesses: [
      {
        title: 'Sharma Plumbing Works',
        type: 'Plumber',
        address: 'MP Nagar, Bhopal',
        lat: 23.2312,
        lng: 77.4231,
        rating: 4.6,
        reviews: 214,
        phone: '+91 98123 45678',
        website: 'https://sharmaplumbing.in/',
      },
      {
        title: 'Verma Electricals',
        type: 'Electrician',
        address: 'Kolar Road, Bhopal',
        lat: 23.2401,
        lng: 77.4012,
        rating: 4.4,
        reviews: 156,
        phone: '+91 90000 12345',
      },
      {
        title: 'Gupta Interiors',
        type: 'Interior designer',
        address: 'New Market, Bhopal',
        lat: 23.2518,
        lng: 77.4096,
        rating: 4.2,
        reviews: 87,
        phone: '+91 94250 12345',
        website: 'https://guptainteriors.in',
      },
      {
        title: 'Patel Coolers & RO',
        type: 'Appliance repair service',
        address: 'Bittan Market, Bhopal',
        lat: 23.2604,
        lng: 77.4182,
        rating: 4.8,
        reviews: 342,
        phone: '+91 98930 12345',
        website: 'https://facebook.com/patelcoolers',
      },
      {
        title: 'Sunrise Dental Clinic',
        type: 'Dentist',
        address: 'Arera Colony, Bhopal',
        lat: 23.2288,
        lng: 77.4391,
        rating: 4.9,
        reviews: 511,
        phone: '+91 93000 11111',
        website: 'https://sunrisedental.in',
      },
      {
        title: 'Khan Carpentry',
        type: 'Carpenter',
        address: 'Old Bhopal',
        lat: 23.2671,
        lng: 77.4051,
        rating: 4.1,
        reviews: 34,
        phone: '+91 99800 12345',
      },
      {
        title: 'Royal Caterers',
        type: 'Caterer',
        address: 'BHEL, Bhopal',
        lat: 23.2712,
        lng: 77.4212,
        rating: 4.5,
        reviews: 128,
        phone: '+91 93330 12345',
        website: 'https://royalcaterers.in',
      },
      {
        title: 'Modern Painters',
        type: 'Painting contractor',
        address: 'Karkhana, Bhopal',
        lat: 23.2455,
        lng: 77.4102,
        rating: 3.9,
        reviews: 19,
        phone: '+91 97520 12345',
        website: 'https://www.justdial.com/Bhopal/Painters/99887766',
      },
      {
        title: 'Sagar Pest Control',
        type: 'Pest control service',
        address: 'Ayodhya Nagar, Bhopal',
        lat: 23.2199,
        lng: 77.4298,
        rating: 4.3,
        reviews: 76,
        phone: '+91 91110 12345',
        website: 'https://sagarpest.in',
      },
      {
        title: 'Deepak Hardware',
        type: 'Hardware store',
        address: 'Tatqa Tola, Bhopal',
        lat: 23.2556,
        lng: 77.4078,
        rating: 4.0,
        reviews: 45,
        phone: '+91 98110 12345',
      },
      {
        title: 'Aashirwad Tailors',
        type: 'Tailor',
        address: 'MP Nagar, Bhopal',
        lat: 23.2298,
        lng: 77.4261,
        rating: 4.7,
        reviews: 233,
        phone: '+91 99220 12345',
        website: 'https://aashirwadtailors.com',
      },
      {
        title: 'Cool Air Services',
        type: 'Air conditioning contractor',
        address: 'Bhopal',
        lat: 23.2561,
        lng: 77.4133,
        rating: 4.2,
        reviews: 61,
        phone: '+91 99220 54321',
        website: 'https://coolairservices.in',
      },
    ],
  },
  Indore: {
    lat: 22.7196,
    lng: 75.8577,
    spread: 0.04,
    businesses: [
      {
        title: 'Rajpurohit Carpentry',
        type: 'Carpenter',
        address: 'Vijay Nagar, Indore',
        lat: 22.7533,
        lng: 75.8937,
        rating: 4.6,
        reviews: 178,
        phone: '+91 98220 12345',
        website: 'https://rajpurohitcarpentry.in',
      },
      {
        title: 'Nandini Beauty Parlour',
        type: 'Beauty salon',
        address: 'Palasia, Indore',
        lat: 22.7198,
        lng: 75.8568,
        rating: 4.5,
        reviews: 402,
        phone: '+91 97720 12345',
      },
      {
        title: 'Om Sai Electricals',
        type: 'Electrician',
        address: 'Bhawarkuan, Indore',
        lat: 22.6989,
        lng: 75.8701,
        rating: 4.0,
        reviews: 58,
        phone: '+91 90000 98765',
        website: 'https://instagram.com/omsaielectricals',
      },
      {
        title: 'Malwa Real Estate',
        type: 'Real estate agency',
        address: 'South Tukajji, Indore',
        lat: 22.7089,
        lng: 75.8601,
        rating: 4.3,
        reviews: 167,
        phone: '+91 93110 12345',
        website: 'https://malwarealestate.in',
      },
      {
        title: 'Shree Ganesh Sweets',
        type: 'Sweet shop',
        address: 'Rajwada, Indore',
        lat: 22.7196,
        lng: 75.8552,
        rating: 4.8,
        reviews: 654,
        phone: '+91 98930 98765',
        website: 'https://shreiganeshsweets.in',
      },
      {
        title: 'Agrawal Photography',
        type: 'Photographer',
        address: 'Indore',
        lat: 22.7289,
        lng: 75.8712,
        rating: 4.4,
        reviews: 93,
        phone: '+91 99620 12345',
      },
      {
        title: 'Kisan Agro Equipment',
        type: 'Farm equipment supplier',
        address: 'Lalbagh, Indore',
        lat: 22.6912,
        lng: 75.8567,
        rating: 3.8,
        reviews: 27,
        phone: '+91 93320 12345',
        website: 'https://kisanagro.in',
      },
      {
        title: 'Laxmi Physiotherapy',
        type: 'Physiotherapist',
        address: 'Rau, Indore',
        lat: 22.6389,
        lng: 75.8278,
        rating: 4.9,
        reviews: 145,
        phone: '+91 91110 98765',
        website: 'https://laxmiphysio.in',
      },
      {
        title: 'New Bombay Bakery',
        type: 'Bakery',
        address: 'Vijay Nagar, Indore',
        lat: 22.7512,
        lng: 75.8901,
        rating: 4.2,
        reviews: 289,
        phone: '+91 97020 12345',
      },
      {
        title: 'Precision Auto Care',
        type: 'Auto repair shop',
        address: 'Nipania, Indore',
        lat: 22.7621,
        lng: 75.8912,
        rating: 4.1,
        reviews: 88,
        phone: '+91 99220 98765',
        website: 'https://precisionautocare.in',
      },
      {
        title: 'Verma Stone Works',
        type: 'Stone contractor',
        address: 'Nipania, Indore',
        lat: 22.7651,
        lng: 75.8944,
        rating: 4.0,
        reviews: 12,
        phone: '+91 94540 12345',
        website: 'https://linktr.ee/vermastone',
      },
    ],
  },
  Jaipur: {
    lat: 26.9124,
    lng: 75.7873,
    spread: 0.045,
    businesses: [
      {
        title: 'Pink City Plumbers',
        type: 'Plumber',
        address: 'C-Scheme, Jaipur',
        lat: 26.9124,
        lng: 75.7873,
        rating: 4.7,
        reviews: 312,
        phone: '+91 98290 12345',
        website: 'https://pinkcityplumbers.in',
      },
      {
        title: 'Hawa Mahal Interiors',
        type: 'Interior designer',
        address: 'Badi Chaupar, Jaipur',
        lat: 26.9178,
        lng: 75.8012,
        rating: 4.4,
        reviews: 121,
        phone: '+91 94140 12345',
        website: 'https://hawamahalinteriors.in',
      },
      {
        title: 'Marble King',
        type: 'Marble contractor',
        address: 'M.I. Road, Jaipur',
        lat: 26.9045,
        lng: 75.8012,
        rating: 4.6,
        reviews: 265,
        phone: '+91 99280 12345',
      },
      {
        title: 'Gokul Sweets & Namkeen',
        type: 'Confectionery',
        address: 'Johari Bazaar, Jaipur',
        lat: 26.9167,
        lng: 75.7998,
        rating: 4.8,
        reviews: 891,
        phone: '+91 93140 12345',
        website: 'https://www.facebook.com/gokulsweetsjaipur',
      },
      {
        title: 'Rajput AC Service',
        type: 'Air conditioning contractor',
        address: 'Malviya Nagar, Jaipur',
        lat: 26.8538,
        lng: 75.8138,
        rating: 4.1,
        reviews: 67,
        phone: '+91 98290 98765',
        website: 'https://rajputacservice.in',
      },
      {
        title: 'Shree Balaji Hardware',
        type: 'Hardware store',
        address: 'Raja Park, Jaipur',
        lat: 26.9034,
        lng: 75.8012,
        rating: 4.3,
        reviews: 154,
        phone: '+91 94310 12345',
      },
      {
        title: 'Kishan Furniture Mart',
        type: 'Furniture store',
        address: 'Chandpole, Jaipur',
        lat: 26.8967,
        lng: 75.7692,
        rating: 4.0,
        reviews: 41,
        phone: '+91 94130 12345',
        website: 'https://kishanfurniture.in',
      },
      {
        title: 'Sunrise Hospital',
        type: 'Hospital',
        address: 'Malviya Nagar, Jaipur',
        lat: 26.8545,
        lng: 75.8134,
        rating: 4.9,
        reviews: 1204,
        phone: '+91 141 402 8888',
        website: 'https://sunrisehospital.in',
      },
      {
        title: 'Jai Hind Tailors',
        type: 'Tailor',
        address: 'Tripolia Bazaar, Jaipur',
        lat: 26.9171,
        lng: 75.7901,
        rating: 4.5,
        reviews: 198,
        phone: '+91 98270 12345',
        website: 'https://jaihindtailors.com',
      },
      {
        title: 'Trimurti Electricals',
        type: 'Electrician',
        address: 'Malviya Nagar, Jaipur',
        lat: 26.8567,
        lng: 75.8098,
        rating: 3.9,
        reviews: 22,
        phone: '+91 90000 45678',
        website: 'https://trimurtielectricals.in',
      },
      {
        title: 'Ganga Water Treatment',
        type: 'Water purification service',
        address: 'Jagatpura, Jaipur',
        lat: 26.9289,
        lng: 75.7561,
        rating: 4.2,
        reviews: 96,
        phone: '+91 93140 98765',
        website: 'https://sulekha.com/ganga-water-treatment-jaipur',
      },
      {
        title: 'Kalyan Jewellers',
        type: 'Jeweler',
        address: 'Raja Park, Jaipur',
        lat: 26.9021,
        lng: 75.8023,
        rating: 4.8,
        reviews: 342,
        phone: '+91 98290 45678',
      },
    ],
  },
};

/** Place ids are synthetic but shaped like Google's, so nothing looks "test". */
function placeIdFor(city: string, index: number): string {
  const seed = `${city}:${index}:localscout`;
  const hash = Array.from(seed).reduce(
    (acc, char) => (acc * 31 + char.charCodeAt(0)) % 0xffffffffffff,
    7,
  );
  return `ChIJ${hash.toString(16).padStart(20, '0').slice(0, 20)}`;
}

function buildResponse(city: string, seed: SeedBusiness, index: number) {
  const place: Record<string, unknown> = {
    position: index + 1,
    title: seed.title,
    place_id: placeIdFor(city, index),
    data_id: `0x89c2${index.toString(16).padStart(4, '0')}b:0x${index.toString(16).padStart(8, '0')}`,
    gps_coordinates: { latitude: seed.lat, longitude: seed.lng },
    rating: seed.rating,
    reviews: seed.reviews,
    type: seed.type,
    types: [seed.type],
    address: seed.address,
    phone: seed.phone,
    hours: 'Open',
  };

  if (seed.website) {
    place['website'] = seed.website;
    place['links'] = { website: seed.website };
  }

  return place;
}

function main(): void {
  // packages/core/scripts -> packages/core -> packages -> repo root
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const outDir = join(repoRoot, 'fixtures', 'serpapi');
  mkdirSync(outDir, { recursive: true });

  let count = 0;
  for (const [city, data] of Object.entries(CITIES)) {
    const places = data.businesses.map((business, index) => buildResponse(city, business, index));
    const payload = {
      search_metadata: {
        id: `localscout-fixture-${city.toLowerCase()}`,
        status: 'Success',
        processed_at: '2026-10-13 09:00:00 UTC',
        total_time_taken: 0.84,
      },
      search_parameters: {
        engine: 'google_maps',
        type: 'search',
        q: `${data.businesses[0]?.type ?? 'business'} in ${city}`,
        ll: city,
        gl: 'in',
        hl: 'en',
      },
      search_information: {
        local_results_state: 'Results for exact spelling',
        query_displayed: city,
      },
      local_results: places,
    };

    const file = join(outDir, `google_maps_${city.toLowerCase()}.json`);
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    count += places.length;
    process.stdout.write(`wrote ${file} (${places.length} places)\n`);
  }

  process.stdout.write(`\n${count} listings across ${Object.keys(CITIES).length} cities\n`);
}

main();
