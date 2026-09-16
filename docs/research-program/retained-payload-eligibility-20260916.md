# Retained-payload eligibility rule — 2026-09-16 (Track 3)

Status: engineering rule for existing captured payloads. Not scientific acceptance, not payload authorization, not production change. No live HTTP is issued by this rule. Frozen `evaluation/research-program/cohorts.json` (`89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543`) is unmodified.

Machine-readable rule: `scripts/research-program/qualify-retained-payload.mjs` (format `ushso.retained-payload-eligibility.v1`). Regression tests: `tests/research-program/retained-payload-eligibility.test.mjs` (mock transport only, zero fetches).

## Retained set (no new retrieval)

Live history on SHA `2efafed96104012da2d17ec14d8a93c5b33a3d25` under `AUTH-PAYLOAD-PILOT` spent 2 of 4 requests (2 remaining). Publisher bytes are gitignored under `verification/research-program/evidence/payloads/pilot-r04/` and absent in a fresh checkout.

| Product | UUID / native ID | Capture SHA-256 | Rows / bytes | Live outcome |
| --- | --- | --- | --- | --- |
| `cms-hcris-hospital-provider-cost-report` | UUID `44060663-47d8-4ced-a115-b53b4c270acb` | `efb538d31b8d51bf8443b12b617271617afd2f73bf379ed53c0e8bdad2eba08f` | 5 / 20751, HTTP 200 | identity FAILED under then-required `PROVNUM` (live rows expose `Provider CCN` = `110130`); receipt `live_payload_identity_mismatch`, `bounded_sample` false. Failure preserved. |
| `cdc-places-local-data-for-better-health` | `swc5-untb` | `d67b34efce9a129cd4d79dc56b05961c2741f41807d6dd54b154c905179ca6f4` | 5 / 3194, HTTP 200 | identity PASSED on `stateabbr`; release UNRESOLVED (`year`). |

File reanalysis `verification/research-program/evidence/reanalysis/hcris-provider-ccn-20260915.json` (candidate `be7d32b6a238571402a94e4723b914f86cc1907a`, `bounded_file_sample`, `live_http` false, `not_a_new_retrieval` true, `reanalysis_of` the failed HCRIS receipt) derives identity under amended `Provider CCN` from retained bytes. Release stays unresolved. It contributes 0 R04.

## 1. Acquisition + authorization

- HCRIS leg: `run-payload-retrieval-pilot.mjs --execute` on `2efafed`. PLACES leg: manually assembled one-off continuation fetch after the collector abort — not a second collector `--execute`. `payload-retrieval-pilot-run.json` is mixed-transport history, not collector-path proof for both legs. The rule discloses this and issues zero new requests (mock-transport tests assert fetch count 0).
- Live authorization: `AUTH-PAYLOAD-PILOT` bound to `2efafed`, products HCRIS + PLACES, exact endpoints, limits 4 total / 2 per source / 5 rows / 131072 bytes per source, credentials none. `AUTH-04` (metadata-only canaries) cannot grant payload retrieval; unregistered IDs fail `UNAUTHORIZED_LIVE_HTTP`.
- Reanalysis authorization: none needed and none claimed. `not_a_new_retrieval` true, ledger spend unchanged (2 used / 2 remaining, per-source 1/1). The rule reads the ledger twice and fails if bytes differ — it never writes the ledger, rebinds AUTH, or resets budget.

## 2. Time / freshness

- Live receipts recorded `2026-09-15T18:40:00Z` (HCRIS) and `18:40:30Z` (PLACES); execution windows `18:40:00Z/20Z` and `18:40:30Z/35Z` are validation-assigned times, not measured socket times. Reanalysis recorded `2026-09-16T13:22:33.314Z` with file-sample window `2026-09-15T21:30:00Z/01Z`.
- Freshness for R04: false. Retained captures from 2026-09-15 are not recent live samples for future R04. Any future R04 sample needs a new authorized live retrieval with an owner AUTH rebind (without ledger reset).

## 3. Product + release identity

- Frozen bindings: HCRIS record `obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17` / native `https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data-viewer`; PLACES record `obs:asset:cdc-socrata:swc5-untb-f762f3e61a350434` / native `swc5-untb`. Live receipt URLs are https, exact authorized hosts (`data.cms.gov`, `data.cdc.gov`), release-scoped substrings (UUID / `swc5-untb`). Forbidden `7cmc-7y5g` absent.
- Product identity: HCRIS requires `Provider CCN` (string) per amendment `HCRIS-IDENTITY-PROVIDER-CCN-20260915` (`PROVNUM` was the PBJ staffing term, not a hospital cost-report JSON field; frozen dictionary `scripts/research/fixtures/cms-cost-grid/hospital.json` has `Provider CCN` / CMS Certification Number, no `PROVNUM`). PLACES requires `stateabbr` (string). Every row is checked; first-invalid-row fails (mixed-rows fixture).
- Release identity: both UNRESOLVED. HCRIS `FY_END_DT` / Fiscal Year End Date is a reporting-period date, not proof of catalog distribution `CostReport_2023_Final`. PLACES `year` is an observation attribute, not proof of the 2025 county-table release (measurement vs publication year undetermined). Claimed `release_id` values on receipts are frozen-identity claims, not verified releases.
- Prepared packet currency: `payload-retrieval-pilot.json` still names `PROVNUM` (pre-amendment history). `packetIdentityCurrency()` flags `stale_pre_amendment_packet` / `must_not_execute_as_is`. History preserved; future live runs need a new packet or explicit revision.

## 4. Integrity + reproducibility analysis

- SHA-256 binding claimed by in-tree receipts for both captures (64-hex, well-formed). In a fresh checkout the gitignored bytes are absent, so the rule reports `bytes_present` false, `sha_verified` false, `reproducibility: unverified_missing_bytes` — and performs no refetch to fill the gap. Where bytes are present (original host), the rule verifies digest, row count (5), and JSON-row shape.
- Reproducibility of identity analysis: HCRIS file reanalysis re-derives identity from retained bytes under `Provider CCN` (first row `110130`, no `PROVNUM`); PLACES identity re-derives from `stateabbr`. Release re-derivation stays unresolved for both. Counts are computed from receipts + requirements + cohort, never from status strings.

## 5. Missing evidence (disclosed, not repaired by re-description)

1. No independent HTTP access log of the CMS/CDC sockets besides captures, SHAs, and receipts.
2. No measured on-the-wire timestamps (validation-assigned, see §2).
3. Mixed-transport provenance gap on the PLACES leg (see §1).
4. Gitignored bytes absent off-host (see §4).
5. Stale prepared packet (see §3).
6. No first-party CMS statement tying Fiscal Year End Date to `CostReport_2023_Final`; no first-party PLACES dictionary tying `year` to the 2025 county table (see `hcris-places-schema-notes-20260915.md`).

## 6. Live vs reanalysis separation

- Live: 2 receipts, `bounded_http_sample`, `live_http` true, AUTH-PAYLOAD-PILOT, execution head `2efafed`. HCRIS failed (preserved), PLACES passed-identity/unresolved-release.
- Reanalysis: 1 receipt, `bounded_file_sample`, `live_http` false, candidate `be7d32b`, same evidence SHA as live HCRIS, does not overwrite live, spends no budget.
- Legacy status hazard: the history reanalysis uses status `bounded_sample` with `bounded_sample` true to mean file-sample identity derived. The rule notes `legacy_status_hazard` and requires future receipts prefer `file_sample_derived`. Both validate; both yield 0 R04.

## 7. Acceptance-contract comparison (R04)

Contract: only `scripts/research-program/qualify-core.mjs` `isR04EligiblePayload()` counts — `_derived_payload_sample` + `_derived_from_frozen_requirements` + `live_http` true + supported + `bounded_sample` + `payload_success` + not fictional/synthetic/catalog/vintage + `_release_check.status` verified + row count > 0. R04 needs 80 such public samples (frozen 100 cohort); restricted routes need verified routes.

Retained comparison: HCRIS live is not a derived sample (failed); PLACES live is derived-identity but release unresolved; reanalysis is derived-identity but `live_http` false and release unresolved. Per-receipt `r04_eligible` false × 3. `payloadSampleCountsFromReceipts` gives `public_sample_complete` 0, target 80, `r04_engineering_target_met` false, `r04_accepted` false. Accurate counts, no refetch:

`{ live_captures: 2, live_identity_failed: 1, live_identity_passed_release_unresolved: 1, reanalysis_file_samples: 1, qualified_r04_samples: 0, live_requests_used: 2, live_requests_remaining: 2 }`

## 8. Validator repairs (failures preserved)

- `ingest-evidence.mjs`: additive file-sample flags (`_file_sample`, `_r04_eligible=false`, `_status_hazard` for legacy status). No throw behavior changed; all prior failures (identity missing, catalog-as-sample, vintage, fictional, AUTH-04, hash mismatch) still fail with the same codes.
- `qualify-core.mjs`: extracted `isR04EligiblePayload()` as the single source of truth; `payloadSampleCountsFromReceipts` delegates with identical predicate. Status strings still never count.
- `validate-payload-retrieval-pilot.mjs`: additive `packetIdentityCurrency()` (+ amended/superseded constants). `validatePayloadRetrievalPilot()` throw behavior unchanged; the prepared packet still validates as prepared/not-authorized history while currency reports stale.

## 9. What this rule does not do

No new retrieval, no ledger spend/reset, no AUTH rebind, no cohort edit, no history rewrite (failed HCRIS attempt, run.json, ledger, packet, reanalysis file all preserved), no R01–R16 acceptance, no HHA/Census expansion, no deploy.
