# Versioned CI technical inventory v1.4.0

This package records a read-only current CI inventory while preserving the complete v1.3 approval chain as historical evidence. It accepts the original root test chain and the exact PR-003 extension, where `test:research-program` is registered and appears immediately after `test:worker`. The current v1.4 subject remains `pending_authorized_review`; this package issues no current approval, release qualification, or deployment authority.

The aggregate runner selects this package only for the exact `ci-verification` / `verification/testing/ci/v1.4.0` / `node tools/validate-package.mjs --validate` descriptor. Direct `--validate` and `--issue` remain strict successor commands and cannot reuse the v1.3 approval. The inventory performs no network requests, writes no receipt, and does not claim that discovered suites have executed.
