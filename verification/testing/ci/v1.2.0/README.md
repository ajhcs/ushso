# CI v1.2 successor — scoped technical attestation

This additive package retains the v1.0 structural CI inventory, workspace/lock
consistency, least-privilege workflow, bounded runner, test-count and mutation
guards. It uses its own package source pins; the predecessor receipt is protected
by its original SHA-256. Retrieval 1.1.0 is intentional and must match its lock
entry. Workspace inventory is rebuilt after new package manifests are installed.

`npm test --prefix verification/testing/ci/v1.2.0` tests technical invariants.
`npm run receipt:draft --prefix verification/testing/ci/v1.2.0` prints a fresh
pending review subject, not a gate result. `--output PATH` writes a new draft only.
`npm run validate --prefix verification/testing/ci/v1.2.0` fails with typed
BLOCKED_APPROVAL_PENDING (exit 2) until authorized evidence and an exact issued
receipt exist. Structural PASS does not claim suites have executed or gate passed.

This successor pins the real previous receipt at
`verification/testing/ci/v1.1.0/receipts/approved.json`; that receipt remains
immutable historical input and no v1.2.0 approval or receipt is copied here.

The approval schema/statement is documented in verification/wp0/v1.3.0/README.md
and enforced by verification/successor-support.mjs. Only after genuine authorized
review, `receipt:issue -- --approval PATH --evidence PATH` exclusively creates the
new receipts/approved.json. Never run the predecessor receipt-write command or
manually edit old hashes. New source/lock/inventory bytes invalidate prior approval.
Reviewer identity/authority must be established outside this file format.
