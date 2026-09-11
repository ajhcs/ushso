# WP11 current-input design review

**Verdict:** `pass_with_implementation_conditions`

The proposed split is the correct bounded follow-up. Do not implement a one-file or 11-file repin, and do not treat unnamed current drift as approved. A portable **154-byte historical snapshot** plus a **separately pending current subject** can preserve strict historical approval, complete current evidence, actual suite execution, no approval transfer, and fail-closed current validation — if the conditions below are written into a new plan amendment.

This review did not implement policy or product changes. The in-memory snapshot check is a **review probe, not an approved artifact**.

Exact unchanged source identity:
- **HEAD** `bc496ee80810b197b484d8e8e73c491b9bf2d871`
- **tree** `6dc42ed3ad951a9fc807c35afc1abc4a114581f8`
- branch `codex/ce-ushso-wp11-design-review-wp11-current-input-revie-1d8f6f69ff2e-7b9ee63c`
- worktree clean
- assigned interface model `grok-4` (not a serving-model attestation)

---

## Verdict in one paragraph

Today’s adapter proves historical WP11 v1.3 approval correctly, then **requires current tree bytes to equal the sealed 154-file inventory** except two named package transitions. That is why PR-005 dies on the first extra file (`ResultCard.test.ts`) and why updating that one pin would only expose the next ten. Original historical preimages **all exist** at `30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0` and match all 154 sealed pins (none unavailable). Current technical evidence already inventories those same 154 paths, including the 11 PR-005 files. Keep the v1.3.0 builder/validator unchanged, stop reading the current tree for historical proof, retain the 154 preimages portably, report every current-vs-historical diff without allowlisting the 11, and keep current approval `null`.

---

## Historical bytes (review probe)

Sealed receipt `verification/wp11/v1.3.0/receipts/approved.json`: **32,419 bytes**, SHA-256 `e596e1b18a0251f611990c9752e1d12fb36cd05dab16bf55cf96e8d1fc431f9d`, **154 files**, **1,347,732** total pinned bytes. Historical subject `294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98`.

| Source | Match | Missing | Mismatch |
|---|---:|---:|---|
| `git show 30fa0c59:<path>` for all 154 | **154** | **0** | **0** |
| this HEAD worktree | 152 | 0 | 2 already-reviewed package transitions |
| integration `0b4d699be77eaf7b57105fe6633033aec2e73062` | 152 | 0 | same 2 |
| PR-005 `941c9cd02a3a87c4239e6b75cdccbf4c8ec095e9` | 141 | 0 | **13** = 11 new + 2 package |

Repo is not shallow; commit `30fa0c59` is present. **Unavailable sealed pins: none.**

HEAD mismatches (already named, not new PR-005 scope):

- `package.json` `25874c7d…` / 3555 → `b6c3469c…` / 3666 (`reviewed_pr003_package_transition`)
- `package-lock.json` `af2070ae…` / 134190 → `37e4a9ec…` / 134511 (`pr085_ci_v14_workspace_lock`)

The 11 **new** PR-005 input changes (independent `git show` vs sealed pins; same set as the diagnosis JSON):

1. `apps/web/src/components/ResultCard.test.ts` `16226fad…` → `a9415f9c…`
2. `apps/web/src/components/ResultCard.tsx` `4f6c605c…` → `7076cda6…`
3. `apps/web/src/lib/catalogAdapter.test.ts` `296231dc…` → `85a35777…`
4. `apps/web/src/lib/catalogAdapter.ts` `6d5519bb…` → `7d4fcb71…`
5. `apps/web/src/lib/researcherGuidance.test.tsx` `268aa7fe…` → `9d3d9cab…`
6. `apps/web/src/lib/researcherGuidance.ts` `52b6964e…` → `d3788287…`
7. `apps/web/src/pages/DatasetDetailsPage.test.tsx` `ae4ba062…` → `03b81272…`
8. `apps/web/src/pages/DatasetDetailsPage.tsx` `856c41e5…` → `1a5e4d65…`
9. `apps/web/src/types/catalog.ts` `2682a2fe…` → `5a2ec4fa…`
10. `apps/web/src/types/discovery.ts` `53b84d32…` → `3d56804e…`
11. `packages/retrieval/tools/retrieval-core-v1.2.mjs` `5763d768…` → `0541f373…`

PR-005 suite failure is first-pin fail-closed, not a complete report: `WP11_HISTORICAL_INPUT_apps/web/src/components/ResultCard.test.ts_CHANGED` (`a9415f9c…` vs `16226fad…`). A one-file repin is insufficient.

---

## Current evidence coverage

Unchanged builder `verification/wp11/v1.3.0/tools/technical-evidence.mjs` SHA-256 `a49f9b19868ccadfc4bca5b748513ffdaf2f873b77c2da7e3609f7d7fe5b3838` (19,967 bytes). Validator `verify.mjs` SHA-256 `442b6cc6e69fae121b25a5c4f44e7b8eb3a96d2a102d115d9d206806ac9085c4`.

Live `buildTechnicalEvidence()` on this HEAD: `status=PASS`, `approved=false`, `approval_status=pending_authorized_review`, **file_count=154**, **added=[], removed=[]**. Current technical subject `7e355d27a6deb558b6626c486472763a7cfd61239e054d16e13256162de3829f` (differs from historical `294d8b40…` and from recorded replay `8d3409bc…` because PR-003 `package.json` is now current). All 11 PR-005 paths are inside that 154-file inventory, so current evidence will hash them when the builder runs on PR-005 bytes. No builder change is required for those files.

Pre-existing builder limitation (do **not** expand in this follow-up): these reads are **not** in `files[]`:

- `worker/index.mjs` (20,728, `0be15165…`)
- `packages/coverage/accounting/v1.0.0/artifacts/public-coverage-view.json` (70,878, `06072196…`)
- `verification/external-authorization/v1.0.0/register.json` (9,417, `335b7d35…`)
- `packages/retrieval/corpus/records.jsonl` (951,117, `c3779b2c…`)

Frozen pins are already inside `technical_evidence.frozen_pins`. Do not re-run the builder against a mixed snapshot + current tree and call that historical proof.

---

## Adapter / snapshot-reader bindings

Keep **two pending current subjects**, not one merged subject:

1. **WP11 technical draft** — unchanged builder/validator on **current** bytes; package `@ushso/wp11-verification-v1.3.0@1.3.0`; approval `null`.
2. **Wrapper** — `@ushso/wp11-current-attestation-adapter-v1.3.0@1.3.0`; bind adapter, tests, policy, **unchanged runner**, **snapshot**, **snapshot-reader**.

Live adapter on this HEAD: `verifyWp11Attestation()` **PASS**; historical approval `approved_original_subject_only`; current/wrapper approval `null`; `boundaries.current_approval_issued=false`. Wrapper subject now `0cb968456fd29f32ad7b3555f81bf1d75f098b219acc9bd9d653b15dc9ae539c` because `tests/wp11-attestation.test.mjs` is 20,794 / `15eaeb96…` vs recorded replay 19,987 / `4d2d90d2…`. `current-replay.json` is prior-candidate evidence, not a live pin.

Direct `node verification/wp11/v1.3.0/tools/verify.mjs --validate` exits **1** `SUCCESSOR_APPROVAL_STALE_SUBJECT`. Aggregate routing already selects only exact wp11 v1.3.0 `--validate` and still runs the four-test suite first. **Do not edit `scripts/run-contract-suites.mjs`.**

Snapshot **must** live under `verification/research-program/ci-attestation/wp11-v1.3.0/`, never under `verification/wp11/v1.3.0/` (`listFiles` of the package dir would change the technical inventory). Reader must verify exact 154 preimages against the sealed receipt (commit `30fa0c59`, path, bytes, SHA-256). Historical proof must not call `readCurrentFile`. Git cross-check is optional corroboration; verification must pass offline from retained bytes.

---

## Allowed vs rejected

**Allowed**
- Byte-identical historical package, approval, evidence, receipt, predecessor proof.
- Portable 154-file snapshot from `30fa0c59` matching sealed pins (~1.35 MiB).
- Historical proof from snapshot preimages + sealed receipt; current attestation from live builder.
- Explicit complete changed-input report; named PR-003 package and PR-085 lock remain labeled current transitions, not historical substitutes.
- Existing route, four-test suite, strict `--validate`/`--issue`, future-version / zero-test / timeout / child-error semantics.
- New bounded PR; PR-085/PR-003 stay prerequisites; PR-082 consumes it; PR-005 functional work may continue but cannot integrate until this combined current-input path passes.
- Three atomic commits; new handoff/evidence; do not relabel PR-085 acceptance.

**Rejected**
- One-file `ResultCard.test.ts` repin, or adding the 11 files to `ALLOWED_PACKAGE_LOCK`-style silent drift.
- Current or synthetic bytes as historical preimages.
- Git-only snapshot with no retained bytes.
- Rebuilding historical technical evidence from mixed snapshot + current unpinned reads.
- Snapshot inside `verification/wp11/v1.3.0/`.
- Merging the 154 current product files into the wrapper subject.
- WP11 v1.4, builder/validator/successor-support edits, root manifest/lock, frozen cohorts, other verification packages, historical approval/receipt edits.
- Transferring historical approval, treating adapter PASS as PR-005 acceptance, or using old gate receipts to qualify new code.

---

## Precise extra scope and negative tests

**Owned files for the amendment:** `scripts/verify-wp11-attestation.mjs`, `tests/wp11-attestation.test.mjs`, `verification/research-program/ci-attestation/wp11-v1.3.0/` (policy, expanded 154-pin record, snapshot, reader, new replay/receipts), `docs/research-program/ci-attestations.md`, plus the follow-up’s own handoff/evidence. Not the runner unless a later exact necessity appears (none found).

**Tests to add**
- Positive: snapshot reconstitutes all 154 pins; historical subject still `294d8b40…`; current builder still pending.
- Missing / extra / one-byte tamper on a snapshot blob.
- Historical substitution: current `ResultCard.test.ts` bytes offered as historical.
- Incomplete inventory vs sealed 154.
- Injected current-file change → new pending technical subject, historical snapshot still PASS.
- Stale wrapper/policy pin (omit reader or wrong snapshot hash).
- Complete diff report for a PR-005-shaped fixture lists all 13 paths (must not first-fail).
- Integration-shaped fixture lists only the two package transitions; neither fixture is approval.
- Existing overclaim, `--validate`/`--issue` `SUCCESSOR_APPROVAL_STALE_SUBJECT`, future-version, zero-test, timeout, child-error cases retained.

**Suggested three commits**
1. Snapshot + reader + adapter split + tests + policy.
2. Replay / historical-pins / command receipts / evidence index for the new PR.
3. Docs + handoff. Leave final head unbound for root.

---

## Structured receipt

```
schema: ushso.wp11-current-input-design-review.v1
assignment_id: wp11-current-input-review
role: review
access: read_only
disposition: pass_with_implementation_conditions
implementation: not_performed
approval_issued: false
release_qualified: false
snapshot_probe_is_approved_artifact: false

source:
  head: bc496ee80810b197b484d8e8e73c491b9bf2d871
  tree: 6dc42ed3ad951a9fc807c35afc1abc4a114581f8
  branch: codex/ce-ushso-wp11-design-review-wp11-current-input-revie-1d8f6f69ff2e-7b9ee63c
  clean: true
  integration_ancestor_0b4d699: true
  pr005_941c9cd_ancestor: false

historical:
  source_commit: 30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0
  subject_sha256: 294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98
  receipt_bytes: 32419
  receipt_sha256: e596e1b18a0251f611990c9752e1d12fb36cd05dab16bf55cf96e8d1fc431f9d
  sealed_file_count: 154
  sealed_total_bytes: 1347732
  original_bytes_at_source_commit: 154/154
  unavailable_pins: []
  git_shallow: false

current_live_probe:
  adapter_status: PASS
  technical_subject_sha256: 7e355d27a6deb558b6626c486472763a7cfd61239e054d16e13256162de3829f
  recorded_replay_technical_subject: 8d3409bc360d9b295c5c21f9b1a2d6ad91f42ff5c946a14aff92cd4b7d97c259
  wrapper_subject_sha256: 0cb968456fd29f32ad7b3555f81bf1d75f098b219acc9bd9d653b15dc9ae539c
  recorded_replay_wrapper_subject: 0e55f850f52b292b1172223abc7eb9980eb1c10a739af806a3bf55571415957c
  current_file_count: 154
  current_approval: null
  direct_validate: { exit: 1, error: SUCCESSOR_APPROVAL_STALE_SUBJECT }

builder_validator_pins:
  technical-evidence.mjs: a49f9b19868ccadfc4bca5b748513ffdaf2f873b77c2da7e3609f7d7fe5b3838
  verify.mjs: 442b6cc6e69fae121b25a5c4f44e7b8eb3a96d2a102d115d9d206806ac9085c4
  technical-evidence.test.mjs: 00944978337fe92fbb8c33d2db42af63721aabfb0b03529ef437d89943ec6392
  successor-support.mjs: 233d1008a823bbde17b1e0e415e34e630be133f2cd7d83040407e7e56ac5356c
  verify-wp11-attestation.mjs: fa711977fa6898210cc93b6fef30b0ab5e2db67797fc30d3a4eec4472c2790bc
  wp11-attestation.test.mjs: 15eaeb96ff4ec7d61b1aedd040edd1b19441e755d0e0fc26a24720ab9232aade

pr005_new_input_changes: 11
already_reviewed_package_transitions: 2
one_file_repin_sufficient: false
```

Decisive commands (read-only): `git rev-parse HEAD` / `'HEAD^{tree}'`; `git cat-file -t 30fa0c59…`; `git rev-parse --is-shallow-repository` → `false`; in-memory Node pin audit (154/154 historical match); `buildTechnicalEvidence()`; `verifyWp11Attestation()`; `USHSO_ALLOW_RECEIPT_WRITES=0 node verification/wp11/v1.3.0/tools/verify.mjs --validate` → exit 1.

**Next step for the controller:** amend a new stable PR plan with the bindings, rejected designs, negative tests, and three-commit split above. Do not start implementation from this review snapshot.