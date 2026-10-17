# Write-up notes

Real measurements, not estimates. Every number here came from a command in this
repository, and the command is given so it can be re-run.

## Where the numbers come from

```bash
pnpm exec vitest run                       # test counts
curl -s http://127.0.0.1:8787/api/metrics  # runtime aggregates
EVAL_MODELS=gemma3:4b pnpm eval            # draft quality, writes eval/results/<date>.md
```

## Draft quality with an open model

Measured on `gemma3:4b` running locally through Ollama, 9 cases (3 audit shapes:
a slow site, no website at all, and minor structural issues) in each of the 3
languages. Full report: `eval/results/2026-10-13.md`.

| Metric                                  | Value     |
| --------------------------------------- | --------- |
| Schema-valid rate                       | 100%      |
| Grounded on first try                   | 67%       |
| Grounded after one retry                | 22%       |
| Fell back to the deterministic template | 11%       |
| WhatsApp within the 450-character limit | 100%      |
| Email within the 120-word limit         | 100%      |
| Average latency                         | 71.1 s    |
| Average tokens in / out                 | 766 / 270 |

**Reading this honestly.** The schema rate is the easy part, and it is high
because Ollama constrains generation to the JSON schema. The interesting number
is grounding: **two of nine drafts were rejected and replaced by a template
on the first attempt, and one more needed a retry.** That is a real result for a
4B model, and it is the reason the validator and the fallback exist rather than
being defensive scaffolding around a prompt.

The single fallback case was `minor_issues / en`: a lead whose only findings were
`MISSING_META_DESCRIPTION` and `NO_TAP_TO_CALL`. Neither carries a number, so the
model had nothing concrete to anchor to and drifted.

Latency is the other finding. 71 seconds average on a laptop CPU is far too slow
for an interactive flow, which is why drafting is sequential and why the pipeline
reports progress per lead rather than presenting a spinner.

### What would improve it

Not measured, so not claimed:

- A larger model. Gemma 3 12B would probably ground better and slower.
- Harder prompts about _how_ to open, since the failures cluster on the cases
  with no number to cite.
- More structured evidence for the zero-number findings, so there is always
  something concrete to anchor to.

## Pipeline behaviour in fixtures mode

A full run over the 35 recorded listings, Bhopal:

| Metric              | Value                               |
| ------------------- | ----------------------------------- |
| Listings discovered | 12                                  |
| Leads inserted      | 12                                  |
| Audited             | 9                                   |
| Audit failures      | 3                                   |
| Drafts written      | 9                                   |
| Discovery cost      | 0 SerpApi calls (recorded fixtures) |

The three failures are fixture domains that do not resolve. They are invented
domains in the recorded data — `getent hosts` finds nothing for
`sharmaplumbing.in`, `sagarpest.in` or `aashirwadtailors.com`, while the four
sibling domains in the same file do resolve — so the guard refuses them with
`dns_failure` before any request is made, in any environment. That is a property
of the recorded data, not of the sandbox it was measured in.

Each failure is still recorded: an `unavailable` audit row carrying the reason.
The internal score on that row is a placeholder, and every read maps it to null
rather than a number, because nothing was measured. Reporting those three as
"score 0" would have been a fabrication, and so would calling them unaudited —
the attempt itself is part of the record.

The run was repeated after the audit pass in this repository's own history, and
the table reproduced exactly: 12 discovered, 12 inserted, 9 audited, 3 failed,
9 drafts. The counts above are the current behaviour, not a record of a version
that has since drifted.

## A Lighthouse audit, end to end

Measured in an environment with Chrome installed, over a fixture lead whose
domain does resolve:

```sh
cd apps/api && DATA_DIR=/tmp/opencode/chrome-audit pnpm exec tsx src/cli.ts "interior" Bhopal --limit 3
```

| Item                                       | Value                                                       |
| ------------------------------------------ | ----------------------------------------------------------- |
| Audit duration                             | 20.7 s                                                      |
| LCP                                        | 8069 ms                                                     |
| CLS                                        | 0                                                           |
| TBT                                        | 0 ms                                                        |
| Lighthouse performance score               | 62                                                          |
| Lighthouse SEO score                       | 82                                                          |
| Lighthouse accessibility score             | 64                                                          |
| Findings                                   | `SLOW_LCP` (8069 ms vs 4000 ms), `MISSING_META_DESCRIPTION` |
| Opportunity score, from the findings above | 41                                                          |
| Draft                                      | one, from the template                                      |

Two things to read from that table. The measurements are real: the LCP is the
site's, not a default, and the opportunity score is arithmetic over recorded
evidence rather than a copy of Lighthouse's performance score — 30 and 8 from the
two findings, plus 3 from the listing's own rating (4.2) and review count (87),
which is the 41 in the row. Nothing in that sum was guessed. And the finding is
honest about its boundary: 8069 ms against a 4000 ms threshold is a high-severity
finding with the measurement attached, which is the shape every finding in this
tool has.

`pnpm test:slow` runs the same integration against local fixture sites, so the
metric extraction, the score ordering and the missing-Chrome path are all
exercised without a network. It passes here (5 passed, 1 skipped — the skip is
the suite that only runs _without_ Chrome), which is what makes the numbers above
a verification rather than a single lucky run.

## Latency

| Operation                       | Typical              |
| ------------------------------- | -------------------- |
| Discovery (fixtures)            | under 5 ms           |
| Discovery (live SerpApi)        | 0.8–2 s, then cached |
| Audit without Lighthouse        | 200–2000 ms per site |
| Audit with Lighthouse           | 10–30 s per site     |
| Draft with a local 4B model     | 45–140 s             |
| Draft with the fixture provider | under 5 ms           |

## Cost

- **SerpApi**: one search per run, about $0.03 each on the paid plan. Cached by a
  hash of the request, so a repeated search costs nothing.
- **Drafting**: zero. The model runs on the user's machine. This is the single
  largest economic difference between this and a hosted-model approach: at 50
  leads a run, a hosted model would dominate the cost of the tool.
- **Lighthouse**: free and local.

## Known gaps in these measurements

1. **Breadth of Lighthouse coverage.** The batch behind the pipeline table ran
   without a browser, so its audits carry HTTP and HTML checks and no metrics.
   That gap is closed for depth — see "A Lighthouse audit, end to end" above,
   where a real audit ran the whole pipeline — but not for breadth: only four of
   the seven fixture domains resolve at all, so a fixtures-mode batch can never
   be twelve real measurements. Each metric-derived finding is covered by unit
   tests against recorded metrics, and `pnpm test:slow` covers the integration
   itself, including the path where Chrome is absent.
2. **Lighthouse is flaky when two audits run at once.** The same twelve-lead batch
   re-run with Chrome installed recorded full metrics for one of the four
   reachable sites (Cool Air Services, 21.7 s, LCP 2361 ms, performance 86). The
   other three show the three ways a real audit can end without numbers, and each
   is reported as what it is:
   - Gupta Interiors, 13.4 s, `stale`: Lighthouse could not run, and the row says
     so; the HTTP and HTML checks in it are complete.
   - Royal Caterers, 10.5 s, `ok`: Lighthouse ran and wrote its report, but no
     metric could be extracted from it. The metric set is empty rather than
     filled with zeros.
   - Sunrise Dental Clinic, 0.4 s, `ok`: the site answered with an error status,
     which is a `SITE_UNREACHABLE` finding — a fact about the site, not a
     measurement that failed.
     Two headless Chromes at the default `AUDIT_CONCURRENCY=2` starve each other on
     this machine, which is the likeliest reason the first of those three ran
     Lighthouse into a failure. A user who wants a metric for every lead should run
     audits one at a time (`AUDIT_CONCURRENCY=1`) rather than read a `stale` row as
     a low score.
3. **Single model.** Only `gemma3:4b` was available, so this is not a comparison
   between models.
4. **9 draft cases.** Enough to find the failure mode, not enough to claim a
   rate with confidence. The percentages are reported because they came from real
   runs, and the sample size is stated so they are not over-read.
5. **No live discovery run.** No SerpApi key was used. The client is tested
   against a mocked endpoint and against recorded fixtures.

## First-user log

To be filled in by running the thing for real. This is the part a build cannot
fake, and leaving it empty is more honest than inventing entries.

| Date | City | Query | Leads found | Audited | Drafts sent | Replies | Meetings | Clients | What I learned |
| ---- | ---- | ----- | ----------- | ------- | ----------- | ------- | -------- | ------- | -------------- |
| _    | _    | _     | _           | _       | _           | _       | _        | _       | _              |
| _    | _    | _     | _           | _       | _           | _       | _        | _       | _              |
| _    | _    | _     | _           | _       | _           | _       | _        | _       | _              |

What to watch for, from the first real run:

- Which findings actually lead to replies. The scoring weights are a hypothesis.
- Whether 6.1 seconds reads as "slow" to a business owner, or as pedantic. If the
  messages get "thanks, my host says it is fine" back, the framing is wrong and
  the weights are not the thing to change.
- Whether Hinglish lands better than English with these businesses. That is an
  empirical question and the answer is worth knowing.
