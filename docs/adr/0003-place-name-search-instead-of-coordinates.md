# ADR-0003: Live discovery searches by place name, not by coordinates

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** the author

## Context

SerpApi's `google_maps` engine accepts two mutually exclusive ways of saying where
to search:

- `ll` — GPS coordinates, in the exact form `@latitude,longitude,zoom`. For
  example `@23.2599,77.4126,12z`.
- `location` — a place name, which SerpApi resolves server-side. It is only
  accepted alongside `z` (zoom) or `m` (height in metres); on its own the request
  is rejected with _"Missing `z` or `m` parameter. Parameter is required when
  using `location` parameter."_

The client sent the city in `ll`:

```ts
url.searchParams.set('ll', request.location); // "Bhopal, India"
```

So every live search failed with `400 Invalid format of the `ll` parameter`.
Live discovery had never worked, with any key. The unit test asserted
`ll === 'Bhopal'`, so the defect was pinned in place rather than caught: a test
that records the broken value is worse than no test, because it reads as
coverage.

Two things had to be true for the feature to work at all, and both were false:

1. the request had to be well-formed, and
2. something had to read `.env`, which nothing did — the README, the settings
   screen, the health check and the manual all instruct the user to put the key
   in that file.

## Decision

Send the place name in `location` with `z=12`, and read `.env` at boot.

`z=12` is a city-wide view: wide enough to include a neighbourhood business,
tight enough that a search for one city does not return its neighbours. It is a
named constant rather than a parameter, because there is no second caller that
would want a different one.

The cache key was changed to match: it hashes `location` and `z` where it
previously hashed `ll`, so a cached response can never be served for a request
that would have asked SerpApi something different.

## Alternatives considered

- **Geocode the city ourselves, then send `ll=@lat,long,12z`.** Preferred on the
  merits: it is the parameter the engine is built around, it gives control over
  the search origin, and the response then reports the coordinates it actually
  used. **Unavailable on the free plan** — `google_maps_geocode`,
  `google_maps_geoloc` and `geocode` all return _"Unsupported `...` search
  engine"_ for a free key. Rejected for now; revisit if the plan supports it.
- **Ship a lookup table of city coordinates** for the cities already recorded in
  the fixtures, falling back to `location` + `z` for anything else. No quota cost
  and exact control for known cities, but it hardcodes data that drifts, and it
  silently gives two different behaviours depending on whether a city happens to
  be in the table. Rejected: a correct result for every city beats a perfect
  result for three of them.
- **Leave the request broken and report it.** Rejected: the fix is four lines and
  the feature is the point of a SerpApi key.

## Consequences

### Positive

- Live search works. Verified against the live API: a `plumber` search in Bhopal
  returns real businesses with locality-level addresses.
- The failure mode is honest. SerpApi's own sentence is surfaced instead of
  "check your API key", which was actively misleading — a 400 means the request
  was malformed, and only a 401 or 403 means the key is wrong.
- `.env` does what the documentation has always said it does.

### Negative

- The search origin is SerpApi's choice, not ours. We do not learn which
  coordinates it resolved the city to, so the request cannot be pinned or
  reproduced exactly — only the query and city can.
- A place-name search is one SerpApi call whose cost depends on SerpApi's
  resolution. It is cached like any other response, so a repeat search is free,
  but the first one for each city-and-query pair is not.

### Neutral

- The `q` parameter no longer carries the city (`plumbers in Bhopal` becomes
  `plumbers`). The city is now in `location`, which is where the engine expects
  it, so the two are not saying the same thing twice.

## Verification

- Official SerpApi Google Maps documentation, read before coding:
  <https://serpapi.com/google-maps-api> — the `ll` format, and the requirement
  that `location` be paired with `z` or `m`.
- Live request against the API with the real key: `ll=@23.2599,77.4126,12z`
  returned 20 results; `ll=Bhopal, India` and `ll=23.2599,77.4126` both returned 400.
- The chosen form was confirmed live before being written:
  `location=Bhopal, India&z=12` returned 20 real Bhopal plumbing businesses.
- Through the app's own code path: 6 listings normalised, `source:
serpapi-cache`, and a repeat run costing `serpApiCalls: 0`.
- A regression test asserts `ll` is absent, `location` is present, and `z` is in
  the range SerpApi accepts — the three things that were wrong.
