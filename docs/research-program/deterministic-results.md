# Deterministic extraction results

Status: **not a publication**. Last good public generation remains `live-2026-09-03-85b50522b420`.

This readout is produced by `scripts/research-program/qualify-deterministic.mjs` from the PR-020 fixture sweep and PR-018 conservative field-meaning helpers. It does not accept R01–R16, change production, or replace the last-good catalog.

## Boundary

- Requirements R01–R16 remain unaccepted.
- Failed empirical thresholds stay failed: R03 (attempt coverage is a reserved fixture budget, not full selected-source execution) and R06 (unresolved dictionary, unit, and key gaps remain). R04 working examples exist only as bounded PR-019 receipts.
- Residual queue is a bounded next-phase list, not the entire 3434 corpus.
- Last-good catalog manifest SHA-256 remains `85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e`.

## Evidence reconciliation

- Every successful deterministic result must carry a matching capture/parser receipt.
- Missing evidence prevents promotion.
- Partial dictionaries and stale CMS dictionary-locator observations are retained with reasons.
- Census keyless HTML and credential-blocked facts are excluded from the residual LLM queue.

## Residual queue

Residual jobs are created only from actual gaps that still have a retained public passage or an explicit insufficient-evidence outcome:

- CMS unresolved dictionary locators → engineering, with the PR-013 public passage.
- CDC HTML-not-JSON-success → engineering, with the classifier public passage.
- Isolated non-searchable PR-004 records → retained with the published isolation reason.

No residual asks a model to discover a missing fact from memory. Credentials, forbidden access, and unknown eligibility are excluded.

## Coverage denominators

- R03 attempt-coverage denominator: 3434 baseline IDs.
- R06 unresolved-essential-field denominator: 3434 baseline IDs.
- These denominators are reproducible from the fixture sweep receipt.

## Next phase

PR-022 receives the residual queue, not the entire corpus. Publication validation is still required before any last-good generation change.
