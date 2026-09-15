# Payload-pilot provenance reconciliation — 2026-09-15

No additional publisher requests were made for this note.

## Two recorded requests

| # | Product | Path | Transport | Evidence |
| --- | --- | --- | --- | --- |
| 1 | HCRIS hospital cost report | `GET https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5` | `scripts/research-program/run-payload-retrieval-pilot.mjs --execute` on SHA `2efafed` | Capture `verification/research-program/evidence/payloads/pilot-r04/cms-hcris-hospital-provider-cost-report.json` sha256 `efb538d3…`, 20751 bytes, 5 rows, HTTP 200. Collector then threw `BOUNDED_SAMPLE_IDENTITY_FIELD_MISSING` (`PROVNUM` missing; live field `Provider CCN`). |
| 2 | CDC PLACES `swc5-untb` | `GET https://data.cdc.gov/resource/swc5-untb.json?$limit=5` | **Manually assembled continuation** after the collector abort: a one-off `fetch` in a Node eval, not a second `--execute` of the repaired collector. | Capture `…/cdc-places-local-data-for-better-health.json` sha256 `d67b34ef…`, 3194 bytes, 5 rows, HTTP 200. Receipt recorded `identity_passed_release_unresolved`. |

Remaining authorized budget after those two GETs: **2 requests**. Redirects: 0. Credentials: none.

## What was not found

Wrangler logs on this host cover `cf:dev` (127.0.0.1:8787), not publisher fetches. No independent HTTP access log of the CMS/CDC sockets was retained besides the captured bytes, SHA-256, and in-tree receipts. Actual on-the-wire timestamps were not recorded by the first collector (receipt times were assigned at validation). The repaired collector records `started_at` / `ended_at` per attempt and persists budget before each hop.

## Manually assembled records

- `verification/research-program/evidence/payload-retrieval-pilot-run.json` was written by the continuation script after HCRIS identity failure, not by a successful full collector return.
- In-tree receipts under `verification/research-program/evidence/pilot-receipts/` bind gitignored capture bytes. They are not a second retrieval.
- AUTH-PAYLOAD-PILOT was rebound from `de47ff0` (gate/CI SHA) to `2efafed` (collector commit / execution SHA) before `--execute`.

The original failed HCRIS attempt is preserved. Later reanalysis must use those bytes and must not imply another retrieval.
