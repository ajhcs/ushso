# Bounded payload-retrieval pilot packet

Status: **prepared, not authorized**. This packet does not execute retrieval.

AUTH-04 covers metadata-only live connector canaries. It does **not** cover payload retrieval. Do not fetch these endpoints until a distinct payload-retrieval authorization is recorded for these exact product IDs, endpoints, and limits.

Machine-readable packet: `verification/research-program/evidence/payload-retrieval-pilot.json`

## Small representative first

Two public JSON products:

| Product | Frozen record ID | Endpoint | Identity check | Limits |
| --- | --- | --- | --- | --- |
| `cms-hcris-hospital-provider-cost-report` | `obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17` | `https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5` | `PROVNUM` string | 2 requests, 128 KiB, 5 rows, 15 s, concurrency 1 |
| `cdc-places-local-data-for-better-health` | `obs:asset:cdc-socrata:swc5-untb-f762f3e61a350434` | `https://data.cdc.gov/resource/swc5-untb.json?$limit=5` | `stateabbr` string | 2 requests, 128 KiB, 5 rows, 15 s, concurrency 1 |

Do **not** substitute PLACES `7cmc-7y5g` for `swc5-untb`.

## Totals

4 requests, 256 KiB, 10 rows, 30 s, concurrency 1. No credentials.

## Later expansion (not this pilot)

- `cms-hha-cost-report` after HCRIS collection and validation succeed.
- `census-acs-5year-data-profiles` (`ACSDP5Y2024`) only with a later key/AUTH packet. 2023 fixtures and keyless HTML are forbidden substitutes.

## Abort

Non-2xx after one 429/503 retry; host outside allowlist; more than 3 redirects; non-JSON; over bytes/rows/time; missing identity field; any request before authorization.

## Receipts

Each successful capture must be an `ushso.evidence-receipt.v1` `core_cell` with SHA-256 of repository-contained bytes, `payload.bounded_sample`, `payload.payload_success`, native/release IDs, request/final URL, HTTP status, content type, bytes, rows, identity checks, and authorization id. `accepted` remains false. Catalog membership, vintage substitution, fiction, and family workflows still cannot count as samples.

## Retention

Store bounded captures under `verification/research-program/evidence/payloads/pilot-r04/`. Do not republish publisher rows. Do not copy 21 MiB objects into git.

Frozen `evaluation/research-program/cohorts.json` is unmodified. Historical receipts remain under `verification/research-program/evidence/history/`.
