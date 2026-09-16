# Retained-payload eligibility rule — 2026-09-16 (Track 3)

Status: engineering rule for existing captured payloads. Not scientific acceptance, not payload authorization, not production change. No live HTTP is issued by this rule. Frozen `evaluation/research-program/cohorts.json` (`89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543`) is unmodified.

Machine-readable rule: `scripts/research-program/qualify-retained-payload.mjs` (format `ushso.retained-payload-eligibility.v1`). Regression tests: `tests/research-program/retained-payload-eligibility.test.mjs` plus Correction-4 `tests/research-program/retained-payload-contract-cases.test.mjs` (mock transport only, zero fetches).

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

## 7. Acceptance comparison, grounded in the R04 text (Correction 4 — 2026-09-17)

Prior wording of this section defined the contract as the existing
`isR04EligiblePayload()` implementation and then concluded the implementation
matched — a circular comparison. That wording is retracted. The contract is the
acceptance text quoted below; the implementation is compared against it across
four cases. Machine-readable ground: `R04_ACCEPTANCE_TEXT` +
`acceptance_grounding.case_analysis` in `qualify-retained-payload.mjs`.

R04 (`docs/research-program/acceptance.md`, status `unaccepted`, frame
`identities_frozen_usability_not_materialized`) — R03/R05 context: R03 needs a
complete attempt ledger (not_attempted is not success); R05 needs every example
field bound to wire names with provenance. R04 builds on both (attempted +
meaningful samples):

- **Master-plan threshold (quote):** "Frozen 100-product cohort has complete
  mandatory source cards. At least 80 publicly accessible products have a recent
  successful bounded sample and exact technical recipe; remaining cohort members
  have verified restricted/manual access routes. Record versions are not extra
  products."
- **Denominator (quote):** "100 frozen product identities from C-002-1.
  Public-sample target uses the public-access subset of that same 100; it does
  not redefine the cohort."
- **Numerator / pass predicate (quote):** "Pass iff all 100 have complete
  mandatory source cards, at least 80 public-access members have recent
  successful bounded samples plus exact recipes, and every remaining member has
  a verified restricted/manual route. Shortfall is reported; the cohort is not
  quietly redefined."

Five evidence dimensions decide whether a candidate sample satisfies "recent
successful bounded sample plus exact recipe" for one numerator slot:

1. **Acquisition provenance** — the capture is bound to an authorization
   (AUTH id, execution head, endpoints, limits, credentials none) with no
   unexplained transport gap. A gap (e.g. the PLACES manual continuation) does
   not auto-fail if disclosed and bridged by receipt + ledger agreement; an
   unregistered capture fails.
2. **Freshness** — the sample is recent relative to evaluation time.
   Validation-assigned execution windows are disclosed as such; retained
   2026-09-15 captures are not recent for future R04. Freshness follows the
   capture, not a later reanalysis timestamp.
3. **Integrity** — bytes are SHA-bound (digest equality on the exact bytes,
   not a claimed string) with row count and JSON-row shape re-verified where
   bytes are present. Gitignored-and-absent bytes are `unverified_missing_bytes`.
4. **Identity** — every row exposes the CURRENT frozen requirement field
   (`Provider CCN` for HCRIS per amendment
   `HCRIS-IDENTITY-PROVIDER-CCN-20260915`; `stateabbr` for PLACES), with frozen
   record/native IDs matching. A superseded field (PROVNUM) fails.
5. **Release verification** — `_release_check.status` is `verified` by frozen
   publisher documentation. A claimed `release_id` string is not proof: HCRIS
   `FY_END_DT` / Fiscal Year End Date is a reporting-period date, and PLACES
   `year` is an observation attribute of undetermined meaning (see
   `hcris-places-schema-notes-20260915.md`). Unresolved release fails the slot.

Four cases, evaluated against that text:

- **(a) Originally authorized live capture.** Qualifies for one slot iff all
  five dimensions hold. `isR04EligiblePayload()` (`_derived_payload_sample` +
  `_derived_from_frozen_requirements` + `live_http` true + supported +
  `bounded_sample` + `payload_success` + not fictional/synthetic/catalog/vintage
  + `_release_check.status` verified + row count > 0) is the Case-A
  live-sample check — one case, not the contract. Present: HCRIS live fails
  identity (failed under then-required PROVNUM, preserved); PLACES live fails
  release (year unresolved). 0 slots.
- **(b) Later local reanalysis of the same bytes.** CAN qualify without a
  refetch iff: SHA-bound to the original capture (digest equality) + auth chain
  intact (`reanalysis_of` link, `not_a_new_retrieval`, no budget spent) +
  identity re-derived under current frozen requirements + release verified +
  exact recipe recorded (`assessReanalysisEligibility()` in `qualify-core.mjs`).
  There is NO blanket refetch rule for `live_http` false: `live_http=false`
  alone never disqualifies; the failing dimension does. Present HCRIS
  reanalysis: auth chain intact, identity derived under `Provider CCN`, recipe
  recorded — but release unresolved (FY_END_DT) and bytes absent off-host, so
  reasons `release_unverified:unresolved`, `integrity_sha_unverified`,
  `integrity_bytes_absent`. 0 slots. A future reanalysis that closes release
  (first-party CMS statement) and re-verifies bytes on the original disk would
  qualify with no new publisher request.
- **(c) Suitably evidenced frozen local payload corpus.** Same five dimensions
  as (b), minus the `reanalysis_of` link: the sample stands on its own
  evidence reference + digest, and acquisition provenance must be evidenced by
  the corpus manifest (`assessFrozenCorpusEligibility()`). "Suitably evidenced"
  means every dimension holds. The present `pilot-r04` corpus is NOT suitably
  evidenced (gitignored/absent bytes, unresolved releases, mixed-transport
  gap) — reasons `acquisition_provenance_unevidenced`,
  `integrity_bytes_absent`, `integrity_sha_unverified`,
  `release_unverified:unresolved`. 0 slots.
- **(d) Capture with missing acquisition/release evidence.** Cannot qualify:
  unregistered IDs fail `UNAUTHORIZED_LIVE_HTTP`; missing SHA, identity, or
  release each fail their dimension. All three present receipts sit in (d) for
  at least one dimension (see `case_d_missing_evidence`).

Retained verdict against the R04 text: HCRIS live 0 (identity), PLACES live 0
(release), reanalysis 0 (release + integrity). Per-receipt `r04_eligible` false
× 3. `payloadSampleCountsFromReceipts` gives `public_sample_complete` 0,
target 80, `r04_engineering_target_met` false, `r04_accepted` false. R04 stays
`unaccepted`. Accurate counts, no refetch ordered by this rule — the failing
dimension (not `live_http=false`) is what a future correction must repair:

`{ live_captures: 2, live_identity_failed: 1, live_identity_passed_release_unresolved: 1, reanalysis_file_samples: 1, qualified_r04_samples: 0, live_requests_used: 2, live_requests_remaining: 2 }`

## 8. Validator repairs (failures preserved)

- `ingest-evidence.mjs`: additive file-sample flags (`_file_sample`, `_r04_eligible=false`, `_status_hazard` for legacy status). No throw behavior changed; all prior failures (identity missing, catalog-as-sample, vintage, fictional, AUTH-04, hash mismatch) still fail with the same codes.
- `qualify-core.mjs`: `isR04EligiblePayload()` is the Case-A live-sample predicate (behavior unchanged; `payloadSampleCountsFromReceipts` delegates identically). Correction 4 adds `assessReanalysisEligibility()` (Case B) and `assessFrozenCorpusEligibility()` (Case C) — pure predicates stating when a local reanalysis or frozen corpus sample can satisfy the R04 text without a refetch. Status strings still never count.
- `qualify-retained-payload.mjs`: Correction 4 adds `R04_ACCEPTANCE_TEXT` (verbatim threshold/denominator/numerator) and `acceptance_grounding.case_analysis`, which compares the three retained receipts against that text across cases (a)–(d). `acceptance_comparison` now labels the live-sample predicate as Case A only. Counts, failures, ledger, and zero-fetch behavior unchanged.
- `ingest-evidence.mjs`: Correction 4 adds the `_reanalysis_of` link flag for `bounded_file_sample` receipts carrying `reanalysis_of` + `not_a_new_retrieval` (Case-B chain). No throw behavior changed.
- `validate-payload-retrieval-pilot.mjs`: additive `packetIdentityCurrency()` (+ amended/superseded constants). `validatePayloadRetrievalPilot()` throw behavior unchanged; the prepared packet still validates as prepared/not-authorized history while currency reports stale.

## 9. What this rule does not do

No new retrieval, no ledger spend/reset, no AUTH rebind, no cohort edit, no history rewrite (failed HCRIS attempt, run.json, ledger, packet, reanalysis file all preserved), no R01–R16 acceptance, no HHA/Census expansion, no deploy.

## 10. INT2-retained unified count (2026-09-17)

Authoritative counting now uses ONE validated pathway — `assessUnifiedRetainedSample()` in `scripts/research-program/qualify-core.mjs` (format `ushso.retained-sample-qualification.v1`) — instead of calling only the Case-A live predicate. It supports live capture, local reanalysis with resolved live reference (`live_http=false` never implies the original was offline; nonempty `reanalysis_of` alone never implies provenance), evidenced frozen corpus, and insufficient-evidence cases across provenance+authorization, freshness (follows original capture; 90-day working rule for R04 "recent"), SHA integrity, frozen product identity, frozen release verification, and exact recipe. Derived/flag fields are stripped inside the count, so forged flags count zero. Counting is over distinct frozen products: a fully-evidenced sample counts once without refetch; live + its reanalysis count once; two releases of one product count once. Failures (missing bytes, digest mismatch, missing auth/provenance, unresolved release, stale acquisition, missing recipe, identity mismatch) count zero. Acceptance-text ambiguities ("recent" threshold; recipe re-executability) are documented narrowly in `RETAINED_FRESHNESS_RULE` / `RETAINED_RECIPE_RULE` with affected cases kept excluded. Present HCRIS/PLACES stay zero with actual limitations (HCRIS identity-failed preserved; PLACES release unresolved; reanalysis release unresolved + bytes absent). Full semantics: `docs/research-program/retained-sample-counting-20260917.md`.
