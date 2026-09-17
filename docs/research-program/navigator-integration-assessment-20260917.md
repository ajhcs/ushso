# Navigator integration and first-increment assessment — 2026-09-17

## Scope and lineage

Combine research `314d71b8e59bd381b448d69532a79187bae3dfe1` and navigator
`2b3b897b5b4c07b38fb423be0e982719d75cb4d3` (common ancestor `9035a81`).
Owner authorized engineering integration into research, not production deployment.
The isolated integration branch is `codex/ushso-navigator-integration-20260917`.
No publisher requests, request-ledger edits, frozen-cohort edits, or scientific acceptance.

## Changes and review disposition

- Resolve conflicting mode implementations in favor of strict `catalogMode.ts`.
  Navigator packets derive mode, paths, generation, version and counts from it.
  Remove the permissive duplicate resolver. The research-candidate Vite alias
  selects the same explicit candidate configuration as the candidate build.
- Candidate AHRF/Sheps profiles are indexed documentation; baseline keeps named gaps.
  Neither is portrayed as successfully tested payload access.
- Bind internal source-detail links to search return context and restore focus to
  the originating brief. Collapse opaque evidence references; remove question and
  generation implementation labels from the main brief.
- Preserve BRFSS participating-jurisdiction / no-nationwide-estimates limitation.
  Present SAHIE all-county scope and annual estimates as publisher documented.
  Present maternal national scope, reporting slices, quarterly revisions and
  suppression rules from the retained publisher description, not inferred tags.
  Exact payload shapes, release timing and untested access remain qualified.
- Fact states for geography, period and grain default to unknown unless supported
  by explicit per-profile states. Documented LTCF period remains documented.

Independent read-only review: `/root/assess_navigator`, separate from implementing
root. Reviewer read both the original increment and combined resolutions, checked
retained records for the fact corrections and reviewed return navigation. Final
working-tree disposition: no remaining integration blocker. Parent authorship is
not independent review. Final immutable-candidate binding is recorded with the
integration handoff outside this source tree.

## Verification

Web suite: 49 files / 235 tests pass. New regressions resolve indexed references
against actual retained corpus/evidence IDs, verify candidate membership and packet
mode agreement, preserve material publisher scope, and test internal detail links.
An initial test failed because its expected SAHIE phrase differed from the retained
wording; corrected to the actual text, with the first failure retained in scratch.

Browser assessment: HCRIS and AHRF question → brief → JSON packet in baseline and
candidate, Chromium/Firefox/WebKit; indexed detail → return focus; 390px overflow;
20 home question links; no uncaught page errors or mixed discover API modes.
External browser requests are blocked by the harness. Scope does not establish AT,
participant acceptance, all 20 journeys, or publisher endpoint availability.

Task-owned receipts/screenshots and harness:
`/mnt/d/tmp/plumbob/ushso-navigator-integration-20260917/`.
Release gate is executed separately on the final committed candidate; its result
must be read from `release-gate.json` there, not inferred from these focused checks.
No production build or deployment is authorized by a passing research gate.

## Assessment

Useful first increment: 20 question-led starting points, 20 profiles across 19 family
IDs, shared brief/packet data, direct source details, and explicit source gaps.
Candidate has 10 indexed profiles / 10 gaps; baseline has 8 indexed / 12 gaps.

Reviewer counted 201 fact rows: 53 publisher documented, 32 USHSO observed,
113 unknown, 2 provisional, 1 conflicting, 0 successfully tested. These are label
counts, not scientific completeness scores; qualified text can contain unresolved
details even when a row's main assertion is documented. Nineteen profiles have at
least one unknown-state field. No claim of 20 complete research-ready sources.

Remaining product work: first-party dictionary/variable/access enrichment, readable
and resolvable evidence locators, and simplifying long briefs that can push ordinary
results down the page. These are the next increment, not grounds to fabricate
coverage or conflate documentation with observed payload access.
