# Status correction — 2026-09-17 (research program)

Branch: `codex/ushso-corrections-20260917` (integration of corr1+corr2+corr4+corr3 on base `f86dc15`).
Frozen `evaluation/research-program/cohorts.json` sha256
`89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543` — unmodified (verified pre/post merge).
No live network in this integration: mock only, no publisher fetches, no ledger resets,
no deploy/scheduler/paid actions. No history rewrite (base remains ancestor; merges only).

## 0. PR 105 is MERGED — retract stale stays-draft claims

- PR 105 state: **MERGED** 2026-09-16T17:42:50Z, merge commit
  `78da769` (Merge pull request #105 from ajhcs/codex/ushso-evidence-ingestion-20260915).
  It is **NOT** a draft.
- The following stale claims are **retracted** as factually wrong about PR state
  (they remain in history as records of what was believed at the time, but must not
  be relied on):
  - `docs/research-program/engineering-readiness-pr105-20260915.md`: section 0 draft wording
    and the line stating PR 105 remains draft.
  - `docs/research-program/payload-provenance-correction-20260916.md`: the PR 105 stays draft line.
  - `docs/research-program/owner-decision-packet-20260915.md`: the Draft PR 105 remains draft line.
- Correction scope is limited to PR-state wording. All other technical content of those
  documents (budgets, R04 non-acceptance, provenance) stands unless separately corrected.

## 1. Completed (done; evidence in repo)

- **WebKit CSP fix**: `upgrade-insecure-requests` scoped to https documents (Track2;
  see `39b749f` and follow-up parity note `348e464`).
- **12-family reconciliation**: family workflow evidence reconciled
  (see `verification/research-program/evidence/family-workflow-summary.json` and
  `docs/research-program/acceptance.md`).
- **Validator/collector implementation**: metadata validator + collector allowlist with
  corrected dataset-resources + api/views endpoints and FORBIDDEN_PAYLOAD guard
  (corr1 `7e8ea3b`, integrated).
- **Gate repair**: offline validation is branch-agnostic; execution authorization binds
  exact candidate HEAD + AUTH materialization + wall-clock validity window before any
  fetch (corr2 `e64c747`, integrated with corr1 conflict resolution preserving both).
- **Contract grounding**: retained-payload eligibility contract grounded in R04 acceptance
  text with contract-case tests (corr4 `af12d4e`, integrated).
- **Candidate scaffolding**: searchable AHRF+Sheps documentation-first candidate
  `v1.3.0-candidate` under `packages/retrieval/versions/v1.3.0/` with candidate manifest,
  validation report, and browser QA fixture (corr3 `6f2de4f`, integrated; baseline
  corpus untouched).

## 2. Incomplete (explicitly NOT done; do not infer)

- **Searchable delivery is candidate-only, not a prod promotion.** corr3 stages
  `v1.3.0-candidate` alongside the untouched baseline; the
  `apps/web/.env.production` candidate default (`VITE_DISCOVERY_API_PATH=/api/candidate/discover`)
  **must NOT go to prod without an explicit promotion decision**.
- **Intended metadata investigation has 0 requests for the intended URLs.** The prior
  live run spent its 2-request budget on the wrong payload endpoints
  (`verification/research-program/evidence/metadata-check-ledger.json`: 2 used / 0 remaining;
  receipts `a25f0526`/`935ea833`). The deviation is recorded in
  `docs/research-program/metadata-endpoint-deviation-20260917.md`; corrected accounting
  is prepared (`metadata-check-ledger-corrected-20260917.json`: fresh 0/2 for the intended
  JSON metadata endpoints; amendment `metadata-check-packet-amendment-20260917.json`)
  with **no live execution yet and no ledger reset** (spent ledgers retained).
- **The integrated gate must be re-run here.** Merging corr1–corr4 changes gate code,
  contracts, and candidate scaffolding; prior per-branch gate evidence does not qualify
  the integrated HEAD. Base `f86dc15` is **not** described as qualified. Gate results for
  this integration branch are recorded separately (commit message / integration report),
  not in this document.

## 3. External (outside this integration; pending on others)

- **Participant sessions**: scheduling, conduct, and session evidence are external inputs.
- **AT (assistive-technology) testing**: external testing activity and results.
- **Account facts**: account-level facts and authorizations outside repo evidence.
- **Scientific R01-R16 decisions**: acceptance/approval decisions (including R04) remain
  with the scientific owners; nothing in this integration accepts, approves, or spends
  scientific authority.

## Provenance

- Integration merges (all `--no-ff`, tips verified before merge):
  - corr1 `origin/codex/ushso-corr1-metadata-20260917` @ `7e8ea3b`
  - corr2 `origin/codex/ushso-corr2-gate-20260917` @ `e64c747`
  - corr4 `origin/codex/ushso-corr4-contract-20260917` @ `af12d4e`
  - corr3 `origin/codex/ushso-corr3-catalog-20260917` @ `6f2de4f`
- corr1+corr2 conflict resolution (`scripts/research-program/validate-metadata-check.mjs`,
  `tests/research-program/run-metadata-check.test.mjs`): preserved BOTH — corr1 corrected
  endpoints/allowlist/FORBIDDEN_PAYLOAD guard/corrected 0/2 accounting AND corr2
  branch-agnostic offline validation/wall-clock execution asserts/refreshed test windows.
  (`scripts/research-program/run-metadata-check.mjs` auto-merged with both hunks intact.)
- Failures and uncertainty preserved: spent ledgers retained, release checks stay
  `unresolved`, no failure dropped, no uncertainty converted to success.
