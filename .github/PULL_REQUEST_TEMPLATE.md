## What this changes

<!-- One or two sentences. What problem does this solve? -->

## Why

<!-- The reason behind the change, not a restatement of the diff. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes locally
- [ ] Tests were added or updated alongside the code they cover
- [ ] Docs updated (`README.md`, `docs/`, or an ADR) if behaviour or setup changed
- [ ] No secrets, `.env`, `data/`, or `ref/` material is committed
- [ ] Screenshots attached for any UI change (hero, hover, modal, dashboard, loader)

## Domain notes

- [ ] Any new finding or score weight is table-driven with tests
- [ ] Any number used in a draft is traceable to a recorded audit measurement
- [ ] LLM output is still schema-validated and grounding-checked
- [ ] `docs/MANUAL_STEPS.md` updated if a new human-only step was introduced

## Known limitations

<!-- Anything a reviewer should know: unmeasured claims, skipped cases, lab-data caveats. -->
