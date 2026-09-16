# Metadata endpoint substitution — execution-scope deviation (2026-09-17)

Status: **deviation recorded, correction prepared, no live HTTP in this task.**
No live network was issued to prepare this note. Frozen `evaluation/research-program/cohorts.json`
sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543` unmodified.

Base: `f86dc150a3ad60986e0809e0ca59616f3b605914` (research head, already includes wrong-URL live run).
Branch: `codex/ushso-corr1-metadata-20260917` (own worktree `/mnt/d/worktrees/plumbob/ushso-corr1-metadata`;
no changes in `/mnt/d/Coding Projects/ushso`).
Integration corrections worktree `/mnt/d/worktrees/plumbob/ushso-corrections-20260917` untouched.

## What was authorized (intended) vs what was fetched (actual)

Intended bounded JSON metadata investigation (per `docs/research-program/track4-cms-cdc-metadata-packet-20260916.md:82,85`,
proposed exact docs if row JSON proved inconclusive):

1. CMS: `https://data.cms.gov/data-api/v1/dataset-resources/44060663-47d8-4ced-a115-b53b4c270acb`
   (resources listing `CostReport_2023_Final.csv` distribution).
2. CDC: `https://data.cdc.gov/api/views/swc5-untb.json`
   (Socrata view metadata: columns, descriptions, release notes for `swc5-untb`, if it defines `year`).

Actually fetched under `AUTH-METADATA-CHECK` (payload endpoints, wrong for a metadata investigation):

1. CMS: `https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5`
2. CDC: `https://data.cdc.gov/resource/swc5-untb.json?$limit=5`

`verification/research-program/evidence/metadata-check-packet.json` `endpoint_provenance` cites
`verification/research-program/authorization/payload-authorizations.json endpoints[0..1]` and
`docs/research-program/payload-retrieval-pilot.md representative-first table` — that provenance is
**wrong for a metadata investigation**. It reuses the payload-pilot endpoints verbatim instead of the
intended metadata URLs above. The packet, collector allowlist (`approvedEndpoint` via
`verification/research-program/authorization/metadata-authorizations.json`), validator
`EXPECTED_ENDPOINTS`, tests, and docs are restored to the intended metadata URLs in this correction;
see packet amendment and corrected ledger (no live execution here).

## Four actual publisher requests across two operations (same bytes, repeated)

No additional publisher requests are made in this correction task. The repository already records
4 publisher GETs across two operations that fetched **identical bytes** (repeats of the same two
payload endpoints):

### Operation 1 — payload pilot under AUTH-PAYLOAD-PILOT (2 requests, correct scope for that AUTH)

- AUTH: `AUTH-PAYLOAD-PILOT`, candidate `2efafed96104012da2d17ec14d8a93c5b33a3d25`.
- CMS HCRIS: 200, 5 rows, 20751 bytes, evidence sha256
  `efb538d31b8d51bf8443b12b617271617afd2f73bf379ed53c0e8bdad2eba08f` (prefix `efb538d3`).
  Capture `verification/research-program/evidence/payloads/pilot-r04/cms-hcris-hospital-provider-cost-report.json`
  (gitignored). Pilot receipt
  `verification/research-program/evidence/pilot-receipts/cms-hcris-hospital-provider-cost-report.json`
  (file sha256 `fbe1a3159bc642feebdb8b7a6e2928822830025336857e5e48a7f78607bedafb`).
- CDC PLACES: 200, 5 rows, 3194 bytes, evidence sha256
  `d67b34efce9a129cd4d79dc56b05961c2741f41807d6dd54b154c905179ca6f4` (prefix `d67b34ef`).
  Capture `verification/research-program/evidence/payloads/pilot-r04/cdc-places-local-data-for-better-health.json`
  (gitignored). Pilot receipt
  `verification/research-program/evidence/pilot-receipts/cdc-places-local-data-for-better-health.json`
  (file sha256 `8ab5a416f77c9888c3d0d4b740007e11ec688f4c0ec9d99521ffbd57cf7e34bd`).
- Ledger `verification/research-program/evidence/payload-retrieval-pilot-ledger.json`: 2 used / 2 remaining
  (max 4; 1+1 per source, max 2 per source). Preserved, not reset.

### Operation 2 — mislabeled repeats under AUTH-METADATA-CHECK (2 requests, wrong endpoints for metadata)

- AUTH: `AUTH-METADATA-CHECK` rebound to `348e4646a529faa85ca1a95168b56592f7d65c72`
  (`codex/ushso-assignment-20260916`, 24h window `2026-09-16T18:24:09Z`–`2026-09-17T18:24:09Z`),
  executed live `2026-09-16T18:24:24Z` (commit `f86dc15`). 0 redirects, 0 retries.
- CMS HCRIS: 200, 5 rows, **20751 bytes**, evidence sha256 **`efb538d3…`**
  (full `efb538d31b8d51bf8443b12b617271617afd2f73bf379ed53c0e8bdad2eba08f`) — byte-identical repeat
  of Operation 1 CMS bytes.
  Attempt `attempt-cms-hcris-hospital-provider-cost-report-1789583064065-fb725e9b`.
  Receipt `verification/research-program/evidence/metadata-receipts/attempt-cms-hcris-hospital-provider-cost-report-1789583064065-fb725e9b.json`
  (file sha256 `a25f0526c2fc79f579b29e45947ece642ad7710505b265485418c7fa4c712dab`, prefix `a25f0526`).
  Identity via Provider CCN, release unresolved (`FY_END_DT` is reporting period, not
  `CostReport_2023_Final` proof).
- CDC PLACES: 200, 5 rows, **3194 bytes**, evidence sha256 **`d67b34ef…`**
  (full `d67b34efce9a129cd4d79dc56b05961c2741f41807d6dd54b154c905179ca6f4`) — byte-identical repeat
  of Operation 1 CDC bytes.
  Attempt `attempt-cdc-places-local-data-for-better-health-1789583064652-cf2cca10`.
  Receipt `verification/research-program/evidence/metadata-receipts/attempt-cdc-places-local-data-for-better-health-1789583064652-cf2cca10.json`
  (file sha256 `935ea833fe55cd45a98c4a94baf7cb00203d589d4e42e27ef062354b6013f493`, prefix `935ea833`).
  Identity via `stateabbr`, release unresolved (`year` is observation attribute, not 2025 county-table proof).
- Ledger `verification/research-program/evidence/metadata-check-ledger.json`: **2 used / 0 remaining**
  (max 2; 1+1 per source). Preserved, not reset. Aggregate 23945 bytes within 131072-byte cap, but spent
  on the wrong endpoints.
- Run report `verification/research-program/evidence/metadata-check-run.json` and the two receipts above
  are preserved as history of what was actually fetched. Publisher bytes stay gitignored; receipts bind
  SHA-256. R04 stays 0/80. Both releases unresolved.

## Ledgers preserved, no reset

- `payload-retrieval-pilot-ledger.json`: 2 used / 2 remaining on `AUTH-PAYLOAD-PILOT` (max 4). Untouched.
- `metadata-check-ledger.json`: 2 used / 0 remaining on `AUTH-METADATA-CHECK` (max 2). Untouched, spent on
  wrong endpoints. Do not reuse its remaining 0 for the intended investigation.
- Corrected accounting uses **separate** files (no reset, no live execution here):
  `verification/research-program/evidence/metadata-check-ledger-corrected-20260917.json`
  (fresh 0 used / 2 remaining, same caps) and
  `verification/research-program/evidence/metadata-check-packet-amendment-20260917.json`
  (intended URLs, same caps, prepared, not authorized). The intended investigation requires a future owner
  AUTH rebind to the exact execution HEAD on this correction branch with a validity window.

## Planned metadata investigation NOT completed

The planned bounded metadata investigation — one CMS `dataset-resources` fetch plus one CDC
`api/views/swc5-untb.json` fetch to seek first-party release statements — has **0 requests issued,
0 bytes captured, 0 receipts**. The two `AUTH-METADATA-CHECK` spends above do not count toward it
because they fetched payload row endpoints, not metadata docs. Do not cite
`metadata-check-ledger.json` (2 used/0), `metadata-check-run.json`, or receipts `a25f0526` /
`935ea833` as proof that the intended metadata URLs were investigated. They prove only that the
payload endpoints were re-fetched byte-identically under a metadata label.

Same caps for the future corrected run (no live execution here): aggregate 131072 bytes (65536 per
source), 15s global wall-clock (15s per-source upper bound), concurrency 1 sequential with exclusive
lock, 0 redirects, 0 retries on 429/503, no credentials, no dictionary downloads beyond the two
bounded JSON metadata docs, JSON content-type, duplicate-query rejection, host allowlist, frozen
cohort SHA enforcement, AUTH materialization, accounting+SHA persistence. Publisher bytes (if later
authorized) go under a separate gitignored captures path; in-tree receipts bind SHA-256.
