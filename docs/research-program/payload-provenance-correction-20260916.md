# Payload provenance correction - 2026-09-16 (docs-only, history preserved)

Status: engineering provenance clarification for draft PR 105. Not scientific acceptance, not payload authorization, not production change. No live HTTP was issued for this note. History files are not rewritten.

Branch: codex/ushso-evidence-ingestion-20260915. Prior head fdeb652c9f3c70d4a9a96ca927de57df5b4e5cd2. Gated engineering candidate after 2a7218434e675bff4916853f968fdc350c63e288 (local gate 20260916T132336Z-365962153af4 passed, hosted CI 35101601431 success). Pilot execution SHA 2efafed96104012da2d17ec14d8a93c5b33a3d25. Frozen evaluation/research-program/cohorts.json sha256 89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543 unmodified. Remaining publisher budget 2 unused. R04 0/80, restricted routes false, r04_accepted=false. PR 105 stays draft.

Separate independent review: Independent-Reviewer-B (Fork) - not Astra/root, not task owner. That review grants no owner authority, no R01-R16 acceptance, no payload authorization, no production change.

## Corrections (clarify without rewriting history)

1. Mixed transport - verification/research-program/evidence/payload-retrieval-pilot-run.json (candidate_head 2efafed, 2 used / 2 remaining) is a historical mixed-transport record, not proof that the repaired collector executed both legs. Leg 1 (HCRIS) was run-payload-retrieval-pilot.mjs --execute on 2efafed and threw BOUNDED_SAMPLE_IDENTITY_FIELD_MISSING under then-required PROVNUM. Leg 2 (PLACES swc5-untb) was a manually assembled one-off Node-eval fetch continuation after that abort, not a second collector --execute. run.json was written by that continuation script, not by a successful full collector return. Do not cite run.json as collector-path proof for both legs. The file itself is preserved as history.

2. Validation-assigned timestamps - the first collector did not record on-the-wire started_at/ended_at; receipt execution times on the two pilot receipts were assigned at validation. The repaired collector records started_at/ended_at per attempt and persists budget before each hop. Receipt started_at/ended_at on pilot-cms-hcris-hospital-provider-cost-report (2026-09-15T18:40:00Z to 20Z) and pilot-cdc-places-local-data-for-better-health (18:40:30Z to 35Z) must be read as validation-assigned, not measured socket times.

3. No independent socket logs - besides gitignored captures (payloads/pilot-r04/cms-hcris-hospital-provider-cost-report.json sha256 efb538d3, 20751 bytes, 5 rows; cdc-places-local-data-for-better-health.json sha256 d67b34ef, 3194 bytes, 5 rows), their SHA-256, and in-tree receipts, no independent HTTP access log of the CMS/CDC sockets was retained. This gap is disclosed; it is not repaired by re-describing the same bytes.

4. Stale prepared packet - verification/research-program/evidence/payload-retrieval-pilot.json (status prepared_not_authorized, recorded 2026-09-15T17:00Z) and docs/research-program/payload-retrieval-pilot.md still require HCRIS field PROVNUM. That requirement is superseded for any future run by amendment HCRIS-IDENTITY-PROVIDER-CCN-20260915 in product-sample-requirements.json (required row field is live/dictionary Provider CCN; PROVNUM is the PBJ staffing term, not a hospital cost-report JSON field). The prepared packet itself is preserved as pre-amendment history and must not be executed as-is. A future live run needs a new packet or explicit packet revision plus an owner AUTH rebind to that HEAD without resetting the ledger.

5. Claimed vs verified release - release_id on stored receipts (CostReport_2023_Final, PLACES_2025_county_table) is the claimed frozen identity, not a verified release. Only _release_check.status verified plus live_http true plus the qualify-core.mjs derivation counts toward R04. Both products remain unresolved (HCRIS FY_END_DT / Fiscal Year End Date is a reporting-period date, not proof of the catalog distribution; PLACES year is an observation attribute, not proof of the 2025 county-table release). Current R04 from these receipts alone is 0.

6. Reanalysis labeling - verification/research-program/evidence/reanalysis/hcris-provider-ccn-20260915.json (candidate be7d32b, bounded_file_sample, live_http false) sets status bounded_sample / bounded_sample true / payload_success true to mean file-sample identity derived from retained bytes under the amended Provider CCN field. It is not a live R04 sample and contributes 0 (release unresolved, live_http false). The history file is not renamed; receipt status strings must never be counted - only the qualify-core.mjs derivation feeds R04. Future receipts should prefer a distinct status such as file_sample_derived to remove this miscount hazard.

7. No-JS flag - walkthrough notes.json flag nojsHasRankedClaim true means the no-JS fallback marker is present in the test harness, not that the no-JS /search page makes a ranked claim. The page copy itself is correctly bounded (title-token fallback list only; ranked discovery requires JavaScript). No code change in this note.

## Actionable findings disposition

- B1 (no execution authority at head: AUTH-PAYLOAD-PILOT names 2efafed): any new retrieval needs an owner rebind without ledger reset. Not executed here; remaining budget stays 2 unused.
- B2 (PLACES-leg provenance gap): corrected by items 1-3 above; run.json stays historical.
- B3 (both releases unresolved): blocks R04 acceptance, restricted-route claims, and HHA/Census expansion. No expansion here.
- B4 (reanalysis miscount hazard): corrected by item 6; no history rename.
- A1-A3 advisory: A1 handled by item 6 clarification; A2 by item 7; A3 (review-record naming .md vs .json) noted for future tasking, not renamed here.

## What this note does not do

- Does not rebind AUTH-PAYLOAD-PILOT, reset the ledger, spend requests, or authorize retrieval.
- Does not accept R01-R16, verify restricted routes, or change production/staging/scheduler.
- Does not rewrite payload-retrieval-pilot-run.json, pilot receipts, ledger, prepared packet, or reanalysis history.
- Does not mark PR 105 ready or merge it.

