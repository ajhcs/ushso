# Corrected metadata-check operation (integration 20260917)

Status: **prepared, not authorized. No live HTTP in this task (0 requests, 0 captures, 0 receipts).**
Frozen `evaluation/research-program/cohorts.json`
sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543` unmodified.
Base: `9035a81bff0b9aa4a6ccba59d7b8d2dad56fbc30`.
Branch: `codex/ushso-int2-metadata-20260917` (worktree `/mnt/d/worktrees/plumbob/ushso-int2-metadata`).

## Problem fixed

`scripts/research-program/run-metadata-check.mjs` fetched the correct metadata URLs but
parsed them as dataset ROWS (`parseRows` wanted an array or `data/rows/results` with 5-row
limits) and emitted payload-sample receipts (`bounded_sample=true`, kind
`bounded_http_sample`). The runner also hardcoded `LEDGER_REL` to the SPENT wrong-endpoint
ledger (`metadata-check-ledger.json`, 2 used/0 remaining) while the amendment described the
separate corrected ledger. This correction defines one coherent operation and makes the
collector resolve everything from packet+auth config, with no fallback to the spent ledger.

Prior deviation record (history, untouched):
`docs/research-program/metadata-endpoint-deviation-20260917.md`.

## One coherent operation

| Slot | Value |
| --- | --- |
| Operation id | `OP-METADATA-CHECK-CORRECTED-20260917` |
| Packet version | `ushso.metadata-check-packet.v2` (`verification/research-program/evidence/metadata-check-packet.json`) |
| CMS endpoint | `https://data.cms.gov/data-api/v1/dataset-resources/44060663-47d8-4ced-a115-b53b4c270acb` |
| CDC endpoint | `https://data.cdc.gov/api/views/swc5-untb.json` |
| AUTH (additive entry) | `AUTH-METADATA-CHECK-CORRECTED-20260917` in `verification/research-program/authorization/metadata-authorizations.json` (prior entry preserved untouched) |
| Ledger | `verification/research-program/evidence/metadata-check-ledger-corrected-20260917.json` (0 used/2 remaining; no reset) |
| Captures (gitignored) | `verification/research-program/evidence/payloads/metadata-check/corrected-20260917/` (subtree of the already-gitignored `payloads/metadata-check/`; no `.gitignore` change) |
| Receipts (in git) | `verification/research-program/evidence/metadata-receipts-corrected-20260917/` |
| Attempts (gitignored) | `verification/research-program/evidence/metadata-attempts/corrected-20260917/` |
| Lock (gitignored) | `verification/research-program/evidence/metadata-attempts/corrected-20260917.lock` |
| Run report (in git) | `verification/research-program/evidence/metadata-check-run-corrected-20260917.json` |
| Candidate binding | branch `codex/ushso-int2-metadata-20260917`, execution binds exact git HEAD + AUTH validity window (branch-agnostic offline validation) |

Packet, AUTH entry, corrected ledger, and collector all agree on the slots above.
The runner exports pure `resolveMetadataOperation(repoRoot)` (reads packet + AUTH register
only; no writes, no fetches) and uses its result for every ledger/capture/receipt path.
A missing or mismatched binding fails closed (`METADATA_OPERATION_UNRESOLVED`,
`METADATA_AUTH_*_MISMATCH`, `METADATA_SPENT_LEDGER_FALLBACK`) before any fetch.
Payload URLs stay forbidden pre-fetch (`METADATA_PAYLOAD_URL_FORBIDDEN`).

Historical files preserved untouched, no ledger resets:
`metadata-check-ledger.json` (2 used/0), `metadata-check-run.json`, old receipts
(`a25f0526`, `935ea833`), `payload-retrieval-pilot-ledger.json`, `history/`.

## Source-specific metadata parsers (documents, not rows)

- CMS `cms-dataset-resources.v1`: recognizes the dataset-resources structure
  (`$.resources[]` distributions); verifies the dataset UUID at
  `$.dataset.uuid | $.dataset.id | $.uuid | $.id` equals
  `44060663-47d8-4ced-a115-b53b4c270acb`; extracts titles, resource names, formats,
  access URLs (`accessURL`/`url`), and distribution dates
  (`issued`/`modified`/`created`) with exact field paths. Wrong UUID is rejected
  (`METADATA_IDENTITY_MISMATCH`). Release `CostReport_2023_Final` verifies only on a
  dated distribution naming it exactly (allowing a `.csv` suffix); anything weaker stays
  `unresolved`, never a failure. Fiscal Year End Date text is recorded under `year_notes`,
  separate from release evidence.
- CDC `cdc-socrata-view.v1`: recognizes the Socrata view structure (`$.id`, `$.name`,
  `$.description`, `$.columns[]`); verifies `$.id === 'swc5-untb'`; extracts name,
  description, and per-column `fieldName`/`name`/`description` with exact field paths.
  Wrong id is rejected (`METADATA_IDENTITY_MISMATCH`). Release
  `PLACES_2025_county_table` verifies only on an explicit release statement
  (`$.metadata.release` / `$.release`); the `year` column is an observation attribute
  recorded under `year_notes`, never release proof. Descriptions of year are kept separate
  from release evidence by construction.
- Row-level identity (HCRIS Provider CCN per HCRIS-IDENTITY-PROVIDER-CCN-20260915;
  PLACES `stateabbr`) still applies to payload rows, not to these metadata docs.

## Metadata receipt format (`ushso.metadata-receipt.v1`)

Stages request-attempted / response-captured / structure-recognized / identity-verified /
release-verified-or-unresolved, carrying op + AUTH ids, execution SHA-256 of the collector,
URLs, times, HTTP status/content-type, bytes, capture hash, parser version, extracted facts
with field paths, limitations, and a typed failure (`{code, message}`, null on success).
Kind is `metadata_check` with `payload.field=source_metadata`: no bounded-sample claim,
so `payloadSampleCountsFromReceipts` ignores these receipts and R04 cannot increment
(`qualify-core.mjs` untouched).

## Limits (unchanged, rows removed)

2 requests (1+1), 131072 B total / 65536 per source, 15 s global and per-source, concurrency 1
sequential with exclusive lock, 0 redirects, 0 retries, no credentials, no dictionary downloads
beyond the two metadata docs. ALL row limits removed from packet, AUTH entry, ledger checks,
collector, and validator.

## Tests

`tests/research-program/run-metadata-check.test.mjs`: offline mock-fixture suite (no live
HTTP). Covers representative CMS/CDC docs, correct-identity-unresolved-release, wrong identity,
malformed JSON, HTML content-type, oversized, stalled, redirect rejection, duplicate query,
exhausted/mismatched ledger, expired/revoked AUTH, concurrent lock, interrupted-execution
budget preservation, payload-URL pre-fetch rejection (fetch count 0), and metadata receipts
counting zero samples. Every failure case asserts the exact code and fetch count.

## Unresolved items (no live execution in this task)

- Both releases stay `unresolved` in the packet until first-party docs prove otherwise.
- `AUTH-METADATA-CHECK-CORRECTED-20260917` is prepared, not authorized: the owner must
  rebind `candidate_head` to the exact execution HEAD with a validity window (no ledger reset).
- 0 requests issued, 0 bytes captured, 0 receipts written under the corrected paths.
