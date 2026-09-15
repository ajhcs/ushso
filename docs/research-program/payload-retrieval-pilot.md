# Bounded payload-retrieval pilot packet

Status: **prepared, not authorized**. This packet does not execute retrieval.

AUTH-04 covers metadata-only live connector canaries. It does **not** cover payload retrieval. Required later authorization id, if granted, is `AUTH-PAYLOAD-PILOT`.

Machine-readable packet: `verification/research-program/evidence/payload-retrieval-pilot.json`

Candidate binding is the current git HEAD of `codex/ushso-evidence-ingestion-20260915` at authorization/execution time. Do not reuse `f6f5e25`.

## Small representative first

Two public JSON products:

| Product | Frozen record ID | Frozen native ID | Endpoint | Release verification | Limits |
| --- | --- | --- | --- | --- | --- |
| `cms-hcris-hospital-provider-cost-report` | `obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17` | dataset UUID `44060663-47d8-4ced-a115-b53b4c270acb` | `https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5` | native UUID. `PROVNUM` string is shape only. `FY_END_DT` is unresolved as catalog-release proof. | 2 requests, 128 KiB, 5 rows, 15 s, concurrency 1 |
| `cdc-places-local-data-for-better-health` | `obs:asset:cdc-socrata:swc5-untb-f762f3e61a350434` | `swc5-untb` | `https://data.cdc.gov/resource/swc5-untb.json?$limit=5` | native id `swc5-untb`. `stateabbr` string is shape only. PLACES `year` is unresolved as measurement vs publication year. `7cmc-7y5g` is forbidden. | 2 requests, 128 KiB, 5 rows, 15 s, concurrency 1 |

## Request accounting

Totals: 4 requests, 256 KiB, 10 rows, 30 s, concurrency 1. No credentials.

The budget includes the initial request, every redirect hop, and every retry. Remaining budget is decremented **before** a hop is followed. Redirect `Location` hosts are validated against the allowlist before follow. One redirect and one 429/503 retry are permitted per source only if budget remains.

## Authorized receipt path

After authorization, captures must keep `live_http=true`. Unauthorized live HTTP is rejected. AUTH-04 cannot grant this path. Execution kind is `bounded_http_sample` with request/final URL, status, content type, redirect chain, row count, and identity/release checks.

## Retention

Publisher bytes go under `verification/research-program/evidence/payloads/pilot-r04/`, which is gitignored. In-tree receipts bind SHA-256 of those gitignored bytes. Do not commit or republish publisher rows. Do not copy 21 MiB objects into git.

## Later expansion (not this pilot)

- `cms-hha-cost-report` after HCRIS collection and validation succeed.
- `census-acs-5year-data-profiles` (`ACSDP5Y2024`) only with a later key/AUTH packet. 2023 fixtures and keyless HTML are forbidden substitutes.

Frozen `evaluation/research-program/cohorts.json` is unmodified. Historical receipts remain under `verification/research-program/evidence/history/`.
