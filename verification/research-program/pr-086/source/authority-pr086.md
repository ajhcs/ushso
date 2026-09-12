# PR-086 — Separate original WP11 input proof from current verification

Phase **P1**, sub-phase **1A**. Status: planned.

Historical WP11 approval remains bound to its exact original inputs while actual current inputs receive separate, unapproved technical checks.

**Dependencies:** PR-003, PR-085

**Implementer:** Luna Max, Grok or DeepSeek; assign one owner at dispatch. **Reviewer:** Astra; named human domain/owner decision when required.

**Acceptance requirements:** R16. **Audit findings:** F01, F32.

## Before editing

Read [EXECUTION.md](../EXECUTION.md), the dependency handoffs and the current repository instructions. Start from the merged integration SHA selected in PR-001, not the stale original workspace. Confirm the paths below in that release; create a new path only when it is named here. If an existing package supplies the required behavior, extend it instead of creating a parallel subsystem.

**Owned scope:**

- `scripts/verify-wp11-attestation.mjs`
- `tests/wp11-attestation.test.mjs`
- `verification/research-program/ci-attestation/wp11-v1.3.0/`
- `docs/research-program/ci-attestations.md`

If a shared contract or another owner’s file must change, record the proposed interface change and resolve ownership before editing it. Keep each commit independently understandable and passing the checks appropriate to that change.

## Atomic commits

### C-086-1 — Retain and verify original WP11 input bytes

Retain all 154 actual historical preimages from commit 30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0 in a portable content-addressed snapshot outside verification/wp11/v1.3.0. Match exact path, length and SHA-256 against the immutable approved receipt e596e1b18a0251f611990c9752e1d12fb36cd05dab16bf55cf96e8d1fc431f9d, subject 294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98. Add a bounded snapshot reader under the owned current-attestation directory and use it for historical input proof. Preserve the historical package, approvals, evidence, receipts and predecessor chain byte-for-byte. Historical validation must work without Git/network and cannot substitute current or synthetic bytes. Keep the existing historical-pins and current-replay records as prior-candidate evidence; new records are additive and clearly identified. The PR006/PR008 combined a30cd77 gate exposes a current-test assumption that equates 156 actual current files with the immutable 154 historical pins. Correct only the current assertion using a test-local independent inventory derived from the declared scope, four broad roots and explicit root files. Compare every path, length and SHA-256, preserving uniqueness and order; never import the builder enumeration as its own oracle. Add meaningful current-file addition, removal, byte-change, duplicate and hash/length negative controls in task-owned temporary fixtures. Retain all historical 154-file, total-byte and subject checks unchanged. Keep named pre-PR005 package transitions portable by retaining exact PR003 package.json and PR085 package-lock.json with a manifest under verification/research-program/ci-attestation/wp11-v1.3.0/named-pre-pr005-fixture/; the historical snapshot directory remains byte-identical. Read these named fixtures without Git or mutable current-file fallback.

**Verify:** Recover and verify 154 files totaling 1,347,732 bytes against the sealed inventory. Test missing, extra, one-byte-tampered and current-substituted blobs, incomplete inventories, duplicate paths and invalid path references. Prove verification from retained bytes with Git unavailable and unchanged historical subject. Rejected bytes cannot yield a passing historical proof. Independent positive current inventory matches the actual candidate, while additions/removals, duplicate records and altered lengths/hashes fail against the unchanged baseline. Named fixture payloads match their separately retained exact reviewed transition hashes and work without Git. Current technical and wrapper drafts remain pending with approval=null.

### C-086-2 — Bind current WP11 checks without transferring approval

Keep the existing WP11 v1.3.0 technical builder, validator, successor helper and general runner unchanged. Invoke the actual builder on current source bytes and validate its complete current inventory. Separately bind adapter, tests, policy, unchanged runner, snapshot and snapshot reader into an explicit current wrapper subject. Preserve distinct technical and wrapper package identities and approval=null on both. Emit every historical-versus-current changed input with both hashes, sizes and source roles; no first-failure-only report or silent allowlist of the 11 PR005 files. Preserve all current technical/disabled-feature checks, strict direct --validate/--issue, exact aggregate routing, actual suite execution, future-version behavior, nonzero-test requirement, error, signal, timeout and output-bound propagation. Do not merge product inputs into a wrapper that substitutes for the existing technical subject or rebuild historical evidence from mixed current/snapshot reads. Record the existing builder coverage limits explicitly without expanding historical package scope or implying full release qualification. The separately owned PR008 v1.2 workspace changes the current lock. After the controller independently reviews exact committed PR008 lock bytes and verifies that the full lock-object delta contains only the new workspace descriptor and its local link, add a separately named PR008_REVIEWED_PACKAGE_LOCK current-input record and pr008_workspace_lock_transition role. Preserve ALLOWED_PACKAGE_LOCK historical/pr085 records, historical proofs, strict direct validation and issue controls. Record exact before/after hashes, lengths, immutable source commit/tree and durable independent review receipt in the current policy reviewed_current_transitions section. Bind the transition review and all three named fixture files into the pending wrapper implementation subject. Fail closed for unknown, partial, altered or unrelated lock changes; no generic dynamic lock approval or future hash is allowed. Scope review and package checks alone are not full PR008 integration acceptance; the exact jointly composed candidate must still pass independent checks and the release gate. The reviewed lock is a required immutable correction input, not a retroactive change to the original accepted PR086 dependencies.

**Verify:** An actual current-file change changes its pending technical subject while original snapshot proof still passes. Missing snapshot/reader bindings, stale policy pins, failed/malformed current evidence and any approval/release overclaim fail. A PR005-941c9cd comparison reports all 13 changed inputs (11 new plus two package transitions); the pre-PR005 integration comparison reports two. Preserve existing real runner, future-version, zero-test, timeout and child-error tests; strict direct validation and issuance still reject historical approval on the current subject. The exact reviewed new lock returns its distinct current role with approval=null and a complete 154-pin current-versus-historical diff. Old named transitions retain their old roles. One-byte mutation, partial workspace/link update, unrelated dependency drift, stale policy/review bindings and unknown bytes remain rejected. Historical approval is rejected for both current subjects.

### C-086-3 — Publish current-input evidence and combined acceptance boundary

Retain sanitized complete commands, snapshot provenance, all original failed receipts, fresh candidate-specific replays and an evidence index. Explain historical approval, current technical draft, wrapper draft and their separate identities in the current-attestation documentation and PR086 handoff. Bind exact integration/dependency/source hashes; a typed pending final head avoids self-reference. PR005 functional work produced under its earlier dependency packet remains historical producer evidence and can integrate only after the combined PR005/PR086 candidate passes independent checks. PR082 consumes this assignment and still resolves current-subject approval and exact release qualification. No historical approval is widened, no current approval is issued and no deployment is performed. Retain the a30cd77 gate failure, initial incomplete test-only proposal and corrected independent scope review. Preserve the original accepted PR086 implementation, handoff and dependency identities as historical records; use a new isolated correction task with an explicit authority packet and append new evidence. The controller reviews every substantive implementation change independently, then composes it with final PR006/PR008 heads for a new gate. No production, deployment, scientific approval, historical repin or R01-R16 acceptance is granted by this correction.

**Verify:** Run the focused WP11 attestation tests, actual selected WP11 aggregate, current adapter and handoff validation. The controller independently inspects original byte hashes, decisive negative cases and the final immutable head, then runs the applicable full gate and hosted CI on the combined candidate. Producer-only success, synthetic overlays and old gate receipts do not qualify the combined result; R01-R16 definitions and frozen cohorts remain unchanged.

## PR acceptance

- Complete original WP11 byte proof remains immutable and independently reproducible offline.
- Every current difference is inspectable and current technical/wrapper subjects remain explicitly unapproved.
- PR005/PR086 combined tests and the exact candidate gate pass without changing strict successor approval or current scientific boundaries.

Use the existing affected package tests plus the specific fixtures described below. Add meaningful regression/integration tests for behavior changes; documentation-only commits use link, schema or artifact checks. Full npm test/build/cf:dry-run run at the integration/release gate.

Run these commands from the isolated repository root after implementing the specified tests. They are planned verification commands, not checks executed by this planning task:

```bash
node --test tests/wp11-attestation.test.mjs
node scripts/verify-wp11-attestation.mjs
node scripts/run-contract-suites.mjs --suite wp11
```

The implementation must demonstrate the behavior above using actual fixtures or retained execution evidence. A source capture is not a payload test; a passing schema is not scientific approval; a successful tool envelope is not a completed research task.

## Handoff and independent review

Write the sanitized evidence index under `verification/research-program/pr-086/` and the task-specific handoff under `docs/research-program/handoffs/PR-086.json`. Follow the [handoff template](../templates/handoff.json). Include exact base/head and dependency SHAs; commands with exit statuses; fixtures and expected/actual results; changed public behavior; source/generation identity; artifact hashes; failures; remaining questions; and the next consumer.

Push the task branch to GitHub and open/update a draft PR using the [PR body template](../templates/pr-body.md). Do not mark it ready until producer checks and handoff validation pass. Astra independently inspects the diff and replays the decisive acceptance checks; producer logs alone are not approval. Retain a failing result when blocked and identify the exact missing input. Do not auto-merge or deploy.
