# PR-007 R3 independent review

Disposition: changes requested. Reviewed HEAD 03dda1e74d4fb30496329592fe4cc4b38084609a, tree 3e04f1865a84bd35cb5aa5def04ff382a98e3ec7. Controller worktree was clean before and after every command. Provider cleanup is normal/inactive_empty/unlocked; actual interface model is grok-4.

The original 14 controller cases, six core/Unicode cases using the refined v3 positive fixture, release-binding tests, identity package tests, package validation, producer verifier, and handoff check all passed on this exact head. R007-6 through R007-8 are corrected for the reviewed cases.

A final bounded review of the public projection and product-context functions reproduced four additional failures with two valid controls passing, zero probe errors. These are correctness/integrity checks using local synthetic fixtures, not payload or scientific qualification.

## R007-9 — A changed core revision retains a stale fingerprint
projectCoreReleaseDecision validates the frozen Release schema and ownership but returns projected=true for an envelope whose publisher_version changed after canonical_content_fingerprint was computed. The supplied hash is sha256:baa89f96252b295147aa9a8dc07a64a9ea722de59fdf7a4ae2cd3a0e950e7192; the actual frozen fingerprintTruthRevision result is sha256:b681b12300af23559f365156dde99f746efda74c88fb2a9e1164256ec7b97d2f. contracts/core/v2.0.0/tools/semantics.mjs checks this invariant as CONTENT_FINGERPRINT_MISMATCH. Reject this as a typed non-projection; do not silently repair a supplied envelope or transfer provenance. The producer's frozenCoreReleaseControl also changes release/entity IDs without recomputing the fixture fingerprint; correct that positive fixture honestly.

The earlier controller v2 fixture had the same stale-fingerprint setup defect. It was retained unchanged; v3 recomputed fixture fingerprints using the actual frozen helper, then reproduced the same five R2 failures and passed all six cases on R3. This refinement is a controller fixture correction, not an additional product regression.

## R007-10 — Nested release relationships are not checked before creating context
Starting from the complete unchanged bindCapturedCatalogRecord output for the retained synthetic CMS catalog/resources fixture, the positive control establishes matching enclosing asset/source, nested release, release list, and every distribution release reference. Each negative changes one field only:
- A distribution's release_id becomes foreign: lookup still returns restart_required=false and the same context fingerprint.
- release_identity.asset_id becomes foreign: lookup still returns restart_required=false and the same context fingerprint.
- releases[0] becomes foreign while the nested release/distributions stay unchanged: lookup emits that foreign release as current product context.

bindingOwnershipRestart checks only enclosing asset/source fields. Validate the complete supplied relationship before accepting its release/distribution IDs. Preserve supported unresolved/rolling/null bindings and one-to-many distributions with typed outcomes; do not require synthetic exact IDs for unknown states. Cover corresponding nested source and ID consistency cases, not only these example literals.

## Evidence
- pr007-controller-review/03dda1e7/receipt.json: all seven commands passed.
- pr007-controller-review/03dda1e7-relationships/receipt.json: relationships command exit 1.
- pr007-controller-review/03dda1e7-relationships/semantics/semantics.json: two passed controls, four failures, zero probe errors.
- pr007-independent-r3-relationships.mjs: full controller probe.
- pr007-independent-r2-extra-v3.mjs and pr007-r2-extra-fingerprint-fixture-refinement.json: retained fixture refinement.
All paths above are relative to /mnt/d/tmp/plumbob/ushso-research-program-20260910. Root publication/integration is pending the corrections. No acceptance or deployment is claimed.
