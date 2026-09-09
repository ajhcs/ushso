# WP0 v1.3 successor — scoped technical attestation

This implemented successor preserves the v1.0 and v1.1 receipts and pins the
real previous successor receipt at
`verification/wp0/v1.2.0/receipts/approved.json`. Technical tests
may pass while `npm run validate` returns `BLOCKED_APPROVAL_PENDING` (exit 2).
The previous receipt is historical input only; no prior approval is inherited
and current approval is determined by the exact-subject validator.

Historical evaluation (143 records) and migration seed (157) are validated with
the unchanged original validator in a temporary artifact tree. Only two mutable
algorithm paths are resolved to byte-exact historical snapshots; their original
hashes remain mandatory. All other original artifacts, manifests, metrics,
counts and identity checks run unchanged. The temporary tree is deleted.

The active 3,434-record lane separately validates every publication-manifest
entry, counts, unique IDs, source slices and current on-demand projection.
It does not claim historical evaluation scores apply to this active corpus.
The complete rolling product boundary and all eight unaffected WP0 prerequisite
checks are recomputed; unexpected predecessor blockers fail closed.

Commands: `npm test --prefix verification/wp0/v1.3.0`; `npm run receipt:draft
--prefix verification/wp0/v1.3.0`; `npm run validate --prefix verification/wp0/v1.3.0`.
Draft JSON contains the exact review subject digest. `--output PATH` creates a
new file exclusively; no receipt command rewrites a predecessor.

Approval requires `approvals/approval.json` and `approvals/evidence.txt` (or
explicit `--approval` / `--evidence` paths). Schema
`ushso-successor-approval.v1.0.0` requires status `approved`, package_id,
subject_sha256, reviewer `{id, role}` (repository_owner or
authorized_release_reviewer), UTC recorded_at, evidence_sha256 and attestation:
`I authorize the successor attestation PACKAGE_ID for subject SUBJECT_SHA256. This does not authorize release, publication, or deployment.`
Evidence must contain that statement and reviewer identity. Recording genuine
authority is a human governance step; matching JSON cannot prove identity.
After authorized review, `receipt:issue` creates `receipts/approved.json` with
exclusive-create semantics. `validate` rebuilds evidence and rejects stale
approvals/receipts. Full release gate and deployment remain separate.
