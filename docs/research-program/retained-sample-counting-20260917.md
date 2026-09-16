# Unified retained-sample counting — 2026-09-17 (INT2-retained)

Status: engineering rule for the authoritative R04 count. Not scientific acceptance, not payload authorization, not production change. No live HTTP is issued. Frozen `evaluation/research-program/cohorts.json` (`89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543`) is unmodified.

Machine-readable rule: `assessUnifiedRetainedSample()` + `payloadSampleCountsFromReceipts(receipts, products, options)` in `scripts/research-program/qualify-core.mjs` (format `ushso.retained-sample-qualification.v1`). Wiring: `scripts/research-program/qualify-retained-payload.mjs` feeds validated integrity (capture SHA, bytes present), frozen release verification (both unresolved for present HCRIS/PLACES), frozen requirements (record/native IDs, row fields, authorized URL scope), and evaluation time into the count. Regression tests: `tests/research-program/retained-sample-counting.test.mjs` (pure, zero fetches) plus existing `retained-payload-eligibility.test.mjs` and `retained-payload-contract-cases.test.mjs`.

## 1. Problem fixed

`payloadSampleCountsFromReceipts()` previously called only `isR04EligiblePayload()` (the Case-A live-sample predicate). Validated reanalysis (Case B) and frozen-corpus (Case C) assessments never fed the authoritative count, so a fully-evidenced local reanalysis could satisfy the R04 text yet count zero in the engineering total, while the count logic trusted validator-derived flags instead of recomputing from receipt fields.

## 2. ONE validated pathway (four cases, six dimensions)

`assessUnifiedRetainedSample(receipt, context)` is the single assessment used by the count. Pure predicate: no I/O, no fetch. Cases are routed from execution truth, never from flags:

- **live_capture**: `live_http===true` + `execution.kind==='bounded_http_sample'` + no `reanalysis_of`.
- **reanalysis_of_retained_bytes**: `live_http===false` + `bounded_file_sample` + non-empty `reanalysis_of` that **resolves** to an existing receipt whose own `live_http===true`. `live_http=false` on the reanalysis never implies the original was offline; a nonempty `reanalysis_of` alone never implies provenance (`auth_chain_unresolved_reference` / `auth_chain_original_not_live` fail otherwise).
- **frozen_local_payload_corpus**: `live_http===false` + `bounded_file_sample` + no `reanalysis_of` + corpus-manifest binding (`acquisitionEvidenceByReceiptId[receipt_id]===true`, else `acquisition_provenance_unevidenced`).
- **insufficient_evidence**: anything else (wrong kind, missing path fields) — excluded.

Six dimensions, recomputed from receipt fields plus explicit context evidence:

1. **Acquisition provenance + authorization** — live: authorized `authorization{id, authorized:true}`, https request/final URLs (host + scope checked when frozen requirements are supplied), 2xx status, RFC3339 execution window. Reanalysis: `not_a_new_retrieval===true` + resolved live original + SHA agreement. Corpus: manifest binding.
2. **Acquisition time / freshness** — documented rule below; follows the original capture for reanalyses.
3. **Retained-bytes integrity (SHA)** — `receipt.evidence_sha256` must be 64-hex with a non-empty `evidence_reference`; a disagreeing claimed payload digest fails (`integrity_sha_mismatch`). Reanalysis/corpus additionally require explicit `{bytesPresent:true, shaVerified:true}` for that receipt (missing bytes fail; no refetch fills the gap). Live enforces supplied integrity maps when present.
4. **Frozen product identity** — `record_id`/`native_product_id` match the frozen cohort anchor (and frozen requirements when supplied); `row_count` positive integer; `result_format` bounded rows. Per-row field presence was verified at ingest against evidence bytes; the count re-checks claim structure with flags stripped.
5. **Release identity** — explicit frozen verification `releaseVerificationByProduct[product_key].status==='verified'`; a claimed `release_id` string alone never verifies. Unresolved/missing fails (`release_unverified:<status>`). Never reads release-check flags.
6. **Exact reproducible recipe** — non-empty `payload.recipe` string (documented rule below).

## 3. Forged flags count zero

Before evaluation the pathway strips every underscore-prefixed validator-derived field (all derived sample/row-count/requirement snapshots, release checks, file-sample markers, reanalysis link flags, evidence-kind markers, scheduler markers, ...) and every bare eligibility flag (`eligible`, `r04_eligible`, `qualified`, `accepted`, ...). Tests forge all of them to eligible values on a receipt whose real fields fail (missing recipe, unresolved release, missing integrity) and assert zero; a fully-evidenced receipt with forged flags set to false still counts once.

## 4. Counting semantics (distinct frozen products)

- The count is over **distinct frozen `product_key` values**, not receipts, releases, passes, or requests.
- A fully-evidenced retained sample (live, reanalysis, or corpus) counts **once without refetch** when every dimension holds.
- A live capture plus its eligible reanalysis of the same product counts **once** (set dedupe).
- Two eligible receipts for one product with different `release_id` values count **once** (annual releases are not products; denominator stays 100).
- Failures count zero: missing bytes, digest mismatch, missing authorization/provenance (including unresolved reanalysis reference or non-live original), unresolved/missing release verification, stale acquisition per the freshness rule, missing recipe, identity mismatch, non-positive row count.

## 5. Freshness rule (ambiguity A1, narrow)

R04 says "recent" without a numeric threshold. Working rule (`RETAINED_FRESHNESS_RULE`, `RETAINED_FRESHNESS_MAX_AGE_DAYS=90`): acquisition `execution.ended_at` must be within 90 days before evaluation time `now` (explicit option, defaults to current time). Freshness follows the original capture for reanalyses, never the reanalysis timestamp. Missing, unparseable, future-dated, or older-than-90d acquisition time is stale and excluded. This threshold is a documented interpretation, not acceptance text; any sample needing a looser reading stays excluded until the text gains a frozen threshold.

## 6. Recipe rule (ambiguity A2, narrow)

R04 says "exact technical recipe" without defining re-executability. Working rule (`RETAINED_RECIPE_RULE`): the receipt must carry a non-empty `payload.recipe` string naming the bounded operation. String presence does not prove re-executability without tacit knowledge; recipes referencing unrecorded manual work stay excluded until a re-execution demonstration exists. Missing/blank recipe fails as `recipe_missing`.

## 7. Present HCRIS/PLACES stay zero (actual limitations)

- HCRIS live: `supported:false`, `bounded_sample:false` — preserved identity failure under then-required PROVNUM; unified reasons include `sample_not_supported`, `not_a_bounded_sample`, `payload_not_successful` plus release/integrity failures.
- PLACES live: identity passes on `stateabbr` but release is unresolved (`year` is an observation attribute, not 2025 county-table proof) and no verified release is supplied — `release_unverified:unresolved`.
- HCRIS reanalysis: auth chain intact and identity re-derived under Provider CCN with recipe recorded, but release unresolved (FY_END_DT) and bytes absent off-host — `release_unverified:unresolved`, `integrity_bytes_absent`, `integrity_sha_unverified`.
- Unified count over the three present receipts is 0 with the retained wiring (integrity from capture checks, releases unresolved from frozen requirements, no corpus manifest, evaluation at reanalysis time). No refetch is ordered; the failing dimension — not `live_http=false` — is what a future correction must repair.

## 8. What this rule does not do

No new retrieval, no ledger spend/reset, no AUTH rebind, no cohort edit, no history rewrite, no R01–R16 acceptance, no deploy/scheduler/paid work. Restricted/manual routes use the pre-existing verified-route check, unchanged.

## 9. Unresolved items (kept excluded)

1. **Recent threshold**: no frozen numeric definition of "recent" in the acceptance text — 90-day working rule applied; older samples excluded (see §5).
2. **Recipe re-executability**: no frozen test for semantic exactness — string-presence rule applied; tacit-knowledge recipes excluded (see §6).
3. **Per-row field re-verification inside the count**: the count re-checks claim structure (IDs, row count, format) with flags stripped; byte-level per-row checks live at ingest. A receipt that never passed ingest cannot qualify here.
4. **Corpus manifest binding for pilot-r04**: no manifest binds the gitignored bytes to an authorized capture — present corpus excluded as `acquisition_provenance_unevidenced`.
5. **Release proof**: no first-party CMS statement ties FY_END_DT to CostReport_2023_Final; no PLACES dictionary ties `year` to the 2025 county table — both releases stay unresolved and excluded.
