# ADR-0002: The SSRF guard checks addresses but does not pin them

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** Localscout maintainer

## Context

Every audit starts from a URL that came out of a search result, which makes it
attacker-influenced: a listing can point anywhere. `assertFetchable` therefore
resolves the hostname, checks **every** address it resolves to against the
private, loopback, link-local, CGNAT and IPv6 transition ranges, and re-checks
each redirect hop. That part is not in question.

What is in question is the gap between the check and the request. There are two
requests, in two runtimes:

1. `safeFetch` — the deterministic HTML checks. Node's `fetch` resolves the
   hostname itself, after the guard has resolved it.
2. Lighthouse — a real Chrome. Chrome resolves the hostname again, follows
   redirects of its own, and then loads whatever subresources the page asks for.

A hostile DNS server can answer the guard's lookup with a public address and the
request's lookup with `169.254.169.254` (the cloud metadata service) or
`127.0.0.1`. The guard would report "public" and the request would go somewhere
private. Nothing in the code prevents that today: the resolved addresses are
returned and recorded, and deliberately not enforced.

## Decision

**Accept the residual for both requests, and write down exactly what the guard
does and does not do.** Connecting to a specific checked address (Node: a custom
`lookup` on an undici `Agent`; Chrome: `--host-resolver-rules`) is not
implemented.

The reasoning, in order of weight:

1. **There is no exfiltration channel to protect.** The tool never sends
   anything. There is no send code path at all: the human reads the draft, copies
   it, and sends it by hand. A request that lands on the metadata service inside
   the user's own network leaks a _response_ to the user's own screen, not data
   to the attacker. The blast radius of a redirect into the private network is a
   page of HTML the user might look at, not a credential leaving the machine.
2. **The attacker needs to control DNS for a host the search returned.** Search
   results point at real business domains. To exploit this, the attacker has to
   be the authoritative resolver for their own domain — at which point they are
   asking a machine on the user's LAN for a page. That is what a browser does
   when a person clicks the same listing, which is the honest comparison.
3. **A pin that is wrong breaks the feature it protects.** Shared hosting, CDNs
   and round-robin DNS legitimately answer with different addresses seconds
   apart. Pinning the first answer turns "audited ok" into "site could not be
   reached", which is a false measurement in the product's core output. The
   project's rule is evidence before words, and a fabricated failure is as wrong
   as a fabricated score.
4. **Chrome cannot be pinned without giving up the measurements.** Lighthouse is
   the source of LCP, CLS and TBT. Its reducer rules are a debugging flag, not a
   security boundary, and a browser that resolves only to pre-approved addresses
   is no longer measuring the site a customer would see.

## Alternatives considered

- **Pin Node's lookup with a custom undici `Agent`** — closes the smaller of the
  two gaps, leaves the browser open, and makes the fetch path depend on undici
  internals. Rejected: half a fix that reads like a whole one.
- **Pin Chrome with `--host-resolver-rules`** — brittle, breaks CDN-hosted sites
  and any page whose subresources resolve elsewhere, and would silently change
  what is measured. Rejected.
- **Reject any host whose address changes between two lookups** — a false
  positive on every CDN-backed small business, which is most of the target
  market. Rejected.
- **Fetch the body with `safeFetch` and measure only that HTML, dropping
  Lighthouse** — removes the only real performance measurements the product
  has. Rejected.
- **Block IP-literal hosts entirely** — already done for anything private; a
  public IP literal is allowed on purpose, because a small business site on a
  bare VPS is a legitimate lead.

## Consequences

### Positive

- Audits of real, CDN-hosted, round-robin sites keep working, which is most of
  them.
- The guard stays a pure, testable function with no runtime hooks, and the
  honest half of the protection — protocol allowlist, all-addresses check,
  per-hop re-check on redirects, no credentials in the request — is real and
  covered by tests.

### Negative

- A hostile resolver can point the _request_ at a private address that the check
  cleared. Accepted for the reasons above, and honest about it in the code:
  `safe-fetch.ts` says in place that this is defence in depth rather than a
  complete pin.

### Neutral

- The addresses are still returned and recorded, so when a mistake is made the
  log says which host passed the check.

## Verification

- Read the paths end to end rather than assuming: `assertFetchable` returns the
  addresses, `safeFetch` discards them (`void pinnedAddresses`), and
  `lighthouse.ts` hands the URL to Chrome.
- Found while writing this: the header of `ssrf.ts` claimed the resolved address
  was pinned "so a second DNS lookup cannot return a different answer", and
  `assertFetchable`'s docblock claimed the caller could "pin them for the
  request". Neither was true. Both comments were corrected in the same commit as
  this record, because a comment that overstates a guarantee is worse than no
  comment: the next reader stops looking.
- The guard's own behaviour is pinned by `ssrf.test.ts` and `safe-fetch.test.ts`
  (all-addresses rejection, per-hop redirect re-check, expanded IPv6 ranges,
  resolver failure closing rather than opening). The residual above is not
  testable, which is part of why it is written down here instead.
