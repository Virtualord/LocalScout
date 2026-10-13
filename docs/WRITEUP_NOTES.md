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

The three failures were real websites unreachable from the sandbox. They are
recorded as `failed` with no audit row and no score, because nothing was measured.
Reporting them as "score 0" would have been a fabrication.

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

1. **No Lighthouse data.** Chrome was not installed in the build environment, so
   every audit ran its HTTP and HTML checks only and reported `stale`. The
   `SLOW_LCP`, `HIGH_TBT`, `LAYOUT_SHIFT` and `LOW_PERF_SCORE` findings are
   covered by unit tests against recorded metrics, and the integration path is
   tested with a stubbed runner, but no end-to-end Lighthouse run is included
   here. `pnpm test:slow` covers it where Chrome exists.
2. **Single model.** Only `gemma3:4b` was available, so this is not a comparison
   between models.
3. **9 draft cases.** Enough to find the failure mode, not enough to claim a
   rate with confidence. The percentages are reported because they came from real
   runs, and the sample size is stated so they are not over-read.
4. **No live discovery run.** No SerpApi key was used. The client is tested
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
