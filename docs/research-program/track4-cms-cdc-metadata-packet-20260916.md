# Track 4 — Bounded CMS/CDC JSON metadata check (prepared, not authorized)

Status: **prepared, not authorized. No live HTTP executed.**

Base: `78da769956e124898b39fb287cd5b018de9fa962`.
Branch: `codex/ushso-track4-metadata-20260916` (own worktree `/mnt/d/worktrees/plumbob/ushso-track4-metadata`; no changes in `/mnt/d/Coding Projects/ushso`).
Frozen cohort: `evaluation/research-program/cohorts.json` sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543` unmodified.
Machine packet: `verification/research-program/evidence/metadata-check-packet.json` (sha256 `857f3ae82053c96839da9272e09331c9ba2c84ceccfa5431226fa1d74a096e97`).
Ledger (separate from payload): `verification/research-program/evidence/metadata-check-ledger.json` (sha256 `22bbaca3565fb1b7374449c870482feb8ba1b3215903cc9b73a2e4bc0441553f`, 0 used / 2 remaining).
Auth (prepared): `verification/research-program/authorization/metadata-authorizations.json` (sha256 `2b211d00c81c1f1dd0b34696cfdd2f454c5041ef19a3811e055c1a1799c8f83a`, `AUTH-METADATA-CHECK` prepared, not authorized).
Collector: `scripts/research-program/run-metadata-check.mjs` (sha256 `e2e52c05e312e2fb250f0809a2057ce64f3deb506ab90ed53edd3878f8b1cc51`).
Validator: `scripts/research-program/validate-metadata-check.mjs` (sha256 `0398b9cd7d6f48762bce4d77e8c6dc408c0c0168d129b6ae98c171b11fecbeb3`).
Tests: `tests/research-program/run-metadata-check.test.mjs` (sha256 `ae9b6c0dd9947b3bca5b2768fd9cf20aaed768d52eb870ebae8239d2b25980b7`, 11 mock tests, all pass; payload regression 15/15 pass).
Readiness: `verification/research-program/evidence/metadata-check-readiness.json`.

Rules: no deploy. Dev commands via `/home/plumbob/bin/with-dev-storage`. No credentials. No live execution in this packet.

## Budget (separate from payload)

Payload ledger remains `2 used / 2 remaining` on `AUTH-PAYLOAD-PILOT` (untouched). This check uses a **separate** ledger starting `0 used / 2 remaining` on `AUTH-METADATA-CHECK`.

| Scope | Requests | Bytes | Rows | Seconds | Concurrency | Credentials |
| --- | --- | --- | --- | --- | --- | --- |
| CMS HCRIS (1 JSON) | 1 | 65536 | 5 | 15 (upper bound) | 1 | none |
| CDC PLACES (1 JSON) | 1 | 65536 | 5 | 15 (upper bound) | 1 | none |
| **Aggregate** | **2** | **131072** | **10** | **15 global wall-clock** | **1 sequential** | **none** |

Byte split sums exactly: 65536+65536=131072. Request split sums exactly: 1+1=2. Row split sums exactly: 5+5=10. Time is a shared 15s global deadline (plus per-source 15s upper bound); the second leg gets the remainder. Concurrency 1 is structural (sequential loop + exclusive lock).

No redirects (0 permitted), no retries (0 permitted on 429/503). Any redirect hop or retry aborts with `METADATA_REDIRECT_NOT_PERMITTED` / `METADATA_RETRY_NOT_PERMITTED` after cancelling the body, spending only the initial unit. Remaining budget is decremented **before** a hop is followed. Redirect `Location` hosts are validated before follow (all redirects abort here). Duplicate query keys are rejected. Host allowlist is enforced per product. Content-Type must include json. Row count capped at 5 per source. Bytes capped at 65536 per source and 131072 aggregate. Source and global deadlines enforced with reader cancel. Exclusive lock prevents double-spend. Frozen cohorts SHA enforced. AUTH must be materialized (authorized true + candidate_head equals execution HEAD) or the run aborts before any fetch.

No extra dictionary downloads in this check (0 here).

## Exact 2 URLs (reused verbatim, no new URLs)

From `verification/research-program/authorization/payload-authorizations.json` endpoints and `docs/research-program/payload-retrieval-pilot.md` representative-first table:

1. `https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5` — CMS HCRIS hospital provider cost report, dataset UUID `44060663-47d8-4ced-a115-b53b4c270acb`, frozen record `obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17`, claimed release `CostReport_2023_Final`.
2. `https://data.cdc.gov/resource/swc5-untb.json?$limit=5` — CDC PLACES, native id `swc5-untb`, frozen record `obs:asset:cdc-socrata:swc5-untb-f762f3e61a350434`, claimed release `PLACES_2025_county_table`. Forbidden vintage `7cmc-7y5g` is rejected.

Identity (amended, shape only): CMS requires live/dictionary **Provider CCN** per `HCRIS-IDENTITY-PROVIDER-CCN-20260915` (PBJ `PROVNUM` is a different product and is forbidden here); CDC requires `stateabbr`. No year equality constraint is present or permitted.

## Accounting + SHA persistence

- Ledger persists every budget mutation before each hop (`metadata-check-ledger.json`).
- Attempts persist per-leg JSON under `verification/research-program/evidence/metadata-attempts/` (gitignored).
- Publisher bytes (if later authorized) go under `verification/research-program/evidence/payloads/metadata-check/` (gitignored via `.gitignore` entry `verification/research-program/evidence/payloads/metadata-check/`). Nothing committed there in this packet (0 captures).
- In-tree receipts go under `verification/research-program/evidence/metadata-receipts/` and bind SHA-256 of the gitignored bytes. No receipts yet (0 live executions).
- This doc and `metadata-check-readiness.json` persist packet/ledger/auth/cohort/collector/validator/test SHAs and mock-test counts.

## Collector enforcement verified BEFORE any live run (mock only, no live HTTP)

Code inspection (track4 worktree only):

- `run-metadata-check.mjs` enforces: exact approved URLs (origin+pathname+exact query map), HTTPS, host allowlist, duplicate query keys, 2 total / 1 per-source request budget (persisted before each hop), 65536 per-source + 131072 aggregate byte caps (reader cancel with `oversized`), 5 per-source + 10 aggregate row caps, per-source 15s + global 15s deadlines (reader cancel with `timeout`), 0 redirects / 0 retries (immediate abort), JSON content-type, credentials forbidden, frozen cohort SHA, AUTH materialization, exclusive lock, sequential concurrency 1.
- Fix applied (mock-verified only): `scripts/research-program/ingest-evidence.mjs` `payloadAuthorizationGranted` now accepts `metadata_check` alongside `payload_retrieval` (`row.action !== 'payload_retrieval' && row.action !== 'metadata_check'`). Without this, `AUTH-METADATA-CHECK` receipts would fail `UNAUTHORIZED_LIVE_HTTP` even with correct endpoints/limits. Payload path unchanged (15/15 regression pass).

Mock tests (no live HTTP, isolated temp repos, mock fetch):

- `tests/research-program/run-metadata-check.test.mjs`: **11/11 pass** via `/home/plumbob/bin/with-dev-storage node --test`.
- Covers: packet consistency, execute-flag gate, missing-ledger no-fetch, 1+1=2 success with SHA persistence, redirect abort (1 unit spent, no follow), 429/503 abort, 65536 byte abort, duplicate-query no-follow, row-limit 6>5 abort, Provider CCN identity with release unresolved (0 qualified samples), lock no-double-spend.
- `validate-metadata-check.mjs` passes on this branch/HEAD.
- Payload regression: `run-payload-retrieval-pilot.test.mjs` **15/15 pass** (ingest fix does not break payload).

No live execution was issued to prove enforcement. All enforcement proof is mock-only and separate from the payload budget.

## Release-identity determination: inconclusive on frozen docs alone (retain)

Based on frozen local documentation only (no live metadata yet):

- HCRIS: dictionary spans “Fiscal Year End Date” as S2 worksheet element. That is a **reporting-period date**, not proof that the catalog distribution is `CostReport_2023_Final`. See `docs/research-program/hcris-places-schema-notes-20260915.md:32` and `verification/research-program/evidence/product-sample-requirements.json` release_check unresolved. **Do not treat FY_END_DT / Fiscal Year End Date as release proof.**
- PLACES: live row field `year` is an **observation attribute**, not a catalog-release identifier. Frozen docs do not state whether `year` is measurement year, publication year, or another concept, or that `year=2025` proves the representative 2025 county table. See `hcris-places-schema-notes-20260915.md:38-40`. Identity on `stateabbr` can pass while contributing **zero** qualified R04 samples. **Do not equate observation year with release year.**

Both `release_verification.status` remain `unresolved` in this packet. No R04 samples are claimed (0/80). No restricted-route, HHA, or Census expansion.

## Exact docs proposed if this JSON metadata is inconclusive (retain + propose, do not fetch here)

If the 2 JSON responses do not contain a first-party release statement, retain unresolved and seek exactly these bounded JSON metadata docs under a later AUTH (1 CMS + 1 CDC at most, no CSV/XLSX payloads in that step):

1. To close HCRIS release: a first-party CMS statement that Fiscal Year End Date (or another captured field) identifies catalog distribution `CostReport_2023_Final`. Candidates (pick at most one bounded JSON metadata fetch):
   - `https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb` (dataset metadata showing distributions, if it names `CostReport_2023_Final`);
   - `https://data.cms.gov/data-api/v1/dataset-resources/44060663-47d8-4ced-a115-b53b4c270acb` (resources listing `CostReport_2023_Final.csv` distribution);
   - `https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report` (landing/distribution notes, if it states the FY End Date to distribution mapping).
2. To close PLACES release: a first-party PLACES data dictionary for `swc5-untb` defining `year` relative to the 2025 county-table release. Candidate (one bounded JSON metadata fetch at most):
   - `https://data.cdc.gov/api/views/swc5-untb.json` (Socrata view metadata: columns, descriptions, release notes for `swc5-untb`, if it defines `year`).

These are proposals only. No dictionary downloads were performed here.

## Readiness (no live execution)

- Packet internally consistent: exact 2 URLs, allocation 1+1, caps 2/131072/10/15/1, accounting 0/0, gitignored bytes + SHA-bound receipts: **yes** (validator pass).
- Collector enforces all caps before running: **yes** (11 mock tests pass + code inspection + ingest fix).
- Frozen cohort unmodified: **yes** (`89130236…`).
- Payload ledger untouched: **yes** (separate file).
- Live executed: **no** (0 captures, 0 receipts, ledger 0 used).
- Authorized: **no** (`AUTH-METADATA-CHECK` prepared, not authorized; payload and AUTH-04 do not cover this).
- Ready for owner decision: **yes** — owner may either authorize `AUTH-METADATA-CHECK` with a rebind to the exact execution HEAD plus a validity window (without resetting either ledger), or defer. No live run until then. Any live run must keep `live_http=true`, persist accounting+SHA, and retain unresolved release status unless first-party docs prove otherwise.
