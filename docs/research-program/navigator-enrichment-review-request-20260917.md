# Independent review request — navigator enrichment increment (2026-09-17)

Status: DRAFT — to be completed after enrichment + frontend integration lands.

## Scope for reviewer (must not have authored the changes)

- Task branch: `codex/ushso-navigator-enrich-20260917` → merge into `codex/research-program-integration-20260910`.
- Base: `a9cb5149132603fc3d5f90a0a429f962d583aaa1` (PR 106).
- Assess: baseline recount (20/20/201/113/19), field inventory, AUTH-DOC-ENRICH-20260917 binding, ledger accounting, per-profile evidence support, brief/detail/packet consistency, baseline/candidate modes, search routing, a11y/focus/mobile/downloads, validator strictness.

## Reviewer checks

1. Each newly supported claim cites product-specific evidence (URL + locator + hash); no unknown→confident inference.
2. Program vs product, observation vs release year, schema-vs-access, ID-vs-join distinctions preserved; contradictions/failures retained.
3. Brief/detail/packet consistency; baseline/candidate membership correct; no unsupported evidence-state promotion.
4. Representative improved questions exercised in Chromium/Firefox/WebKit + mobile/keyboard/return-focus/downloads/error recovery.
5. Required gate run on final immutable candidate; failed attempts + resolutions visible.

## Artifacts to read

- `docs/research-program/source-field-baseline-20260917.md`
- `docs/research-program/documentation-enrichment-inventory-20260917.md`
- `docs/research-program/doc-enrichment-batch*-20260917.md`
- `docs/research-program/navigator-frontend-plan-20260917.md`
- `verification/research-program/authorization/documentation-enrichment-authorizations.json`
- `verification/research-program/evidence/documentation-enrichment-ledger.json`
- `verification/research-program/evidence/doc-enrichment-20260917/`
- `apps/web/src/data/researchNavigator.ts` + tests
- `apps/web/src/components/PriorityResearchNavigator.tsx` + tests
