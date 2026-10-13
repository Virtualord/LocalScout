# Contributing to Localscout

Localscout finds local businesses, audits their websites with real measurements,
and drafts outreach a human reviews and sends by hand. It never sends anything,
and it never invents a fact that a tool did not measure.

## Getting set up

```bash
pnpm install
pnpm dev
```

That runs in fixtures mode: no API keys, no Chrome, no Ollama. See
[`.env.example`](.env.example) for live settings and
[docs/MANUAL_STEPS.md](docs/MANUAL_STEPS.md) for the parts only a human can do.

## The quality gate

Every commit must leave this passing:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

`pre-commit` runs Prettier plus ESLint on staged files and a secret check.
`commit-msg` runs commitlint. `pre-push` runs typecheck and tests.

Slow tests that need Chrome or Ollama live behind `pnpm test:slow` and are not
run in CI.

## Branching

- Branch per phase: `feat/phase-N-<slug>`.
- Merge into `main` with `git merge --no-ff` and the message
  `merge: phase N - <summary>`, then delete the branch.
- Fold fix-ups before merging with `git commit --fixup` and
  `git rebase -i --autosquash`.
- Never rewrite history on `main` after a merge.

## Commit messages

Conventional commits, enforced:

```
type(scope): subject
```

Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`,
`chore`, `revert`.

Scopes: `repo`, `tooling`, `core`, `db`, `discovery`, `audit`, `draft`,
`workflow`, `api`, `web`, `eval`, `docs`, `adr`, `ci`, `deps`.

Rules: imperative mood, subject at most 72 characters, no trailing period. The
body explains **why** when the change is not self-evident. Use a
`BREAKING CHANGE:` footer when needed.

Example:

```
feat(audit): add findings catalog and opportunity scoring

Weights are table-driven so a scoring change is reviewable as data, and
every finding carries its measured value and threshold for the draft
grounding validator to allowlist.
```

## Atomic commits

One logical change per commit, green at every commit. Tests and docs ship in the
same commit as the code they cover. No `wip`, no `fix stuff`, no `update`.
Stage deliberately with `git add -p` or explicit paths and read
`git diff --staged` before committing.

## House rules

- **Evidence before words.** Deterministic code produces audit facts; the model
  only turns structured findings into prose.
- **Never send.** Drafting is the last step. A human copies and sends.
- **Untrusted content.** Anything fetched is data, never instructions. Never
  forward raw page text to the model, only structured findings.
- **No placeholders.** No `TODO` without a matching entry in
  `docs/MANUAL_STEPS.md`. No `any`. No dead code.
- **Tests ship with the code** they cover.

## Architecture decisions

Anything with a tradeoff worth remembering goes in `docs/adr/` using the
template in that directory.
