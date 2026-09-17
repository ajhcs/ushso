# Documentation-enrichment evidence — OP-DOC-ENRICH-20260917

Operation `OP-DOC-ENRICH-20260917` under `AUTH-DOC-ENRICH-20260917` (valid 2026-09-17 to 2026-09-24).
Ledger: `../documentation-enrichment-ledger.json`.

## Layout

- `captures/<product_key>-<yyyymmdd>-<shortsha>.<ext>` — exact source bytes (HTML/PDF/JSON) per evidence/storage rules.
- `receipts/<product_key>-<yyyymmdd>-<shortsha>.json` — receipt with URL, retrieval time, SHA-256, bytes, excerpts/locators, typed failures.
- `attempts/<id>.json` — per-request attempt (including redirects/retries, each charged).

## Rules

- Every request, redirect, retry charged BEFORE execution against the 100-request / 100 MiB budget.
- Max 10 MiB per response, 30s per request, 2 concurrent (1 per host), 2 redirect hops, 1 transient retry.
- Approved hosts only; reject private-network, credentials, out-of-scope content before following/parsing.
- Eligible: product pages, dictionaries, codebooks, methodology, release notes, manifests, API schema/metadata, access instructions. Excluded: row endpoints, bulk files, repeat HCRIS/PLACES payload.
- Retain hashes, URLs, times, excerpts/locators, typed failures.
