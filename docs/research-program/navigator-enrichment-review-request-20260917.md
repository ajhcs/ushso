# Independent review request — navigator enrichment increment (2026-09-17)

Status: READY FOR REVIEW — code complete at db23826 (recount doc). Reviewer: independent agent with no authored changes on this branch.

## Scope for reviewer (must not have authored the changes)

- Task branch: `codex/ushso-navigator-enrich-20260917` → merge into `codex/research-program-integration-20260910`.
- Base: `a9cb5149132603fc3d5f90a0a429f962d583aaa1` (PR 106). Head at review start: `db23826`.
- Change stack: field baseline + AUTH-DOC-ENRICH-20260917 (a75bc8d/0b57589), evidence layout (ca79805), frontend plan + failing-first tests (71bb88c), F-05 journey fix (bd7e291), redacted batch1 (37d24bc), batch1 data integration (9cd25cd), six-section briefs (aa92424), brief-origin + receipt fixes (fa2b7a6), deferred follow-ups (5de4af0), redacted batch2 (647ec5f), batch2 data integration (b663bdc), recount (db23826).
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
