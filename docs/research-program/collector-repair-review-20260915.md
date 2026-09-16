# Independent engineering review — complete payload-retrieval collector

Reviewer: Astra/root (engineering). This note cannot grant owner authority, accept R01–R16, spend remaining publisher requests, or change production.

Candidate branch: `codex/ushso-evidence-ingestion-20260915`. Frozen `cohorts.json` unmodified. Remaining publisher budget: **2 unused**. Original failed HCRIS live attempt on SHA `2efafed` preserved. Browser walkthrough evidence under `verification/research-program/evidence/browser-walkthrough-20260915-final/` is unchanged this round.

Scope reviewed: `scripts/research-program/run-payload-retrieval-pilot.mjs`, AUTH register, packet, ledger, ingest/qualify-core boundaries, and tests. Review is of the implementation, not only the supplied cases.

## Authorization scope

- Execution still requires `--execute`, AUTH-PAYLOAD-PILOT authorized, exact `candidate_head` = git HEAD, and frozen cohorts sha256.
- AUTH-04 cannot grant this path. Unregistered IDs fail `UNAUTHORIZED_LIVE_HTTP`.
- Approved URLs are product-scoped: origin, pathname, and **exact query map**. Extra keys, missing keys, value changes (`size=50`), and **duplicate keys** (`size=5&size=5`) fail before follow.
- Remaining live budget is still bound to AUTH-PAYLOAD-PILOT limits (4 total / 2 per source). Rebinding AUTH to a later SHA does **not** reset used units; `candidate_head` on the ledger stays the original spent-authorization SHA, while `execution_heads` records later collector SHAs.

## Ledger persistence

- Missing ledger is `PILOT_LEDGER_REQUIRED`. `allowMissingLedger` and `emptyLedger` are **removed**; passing the old option cannot recreate a zeroed ledger.
- Used + remaining must equal max, per source and in total. Overspend and source/total mismatch fail closed.
- Each issued GET (initial, redirect, retry fetch) decrements budget **before** the request is sent. Interrupted fetches keep the reserved unit.
- Exclusive lock file: overlapping invocations fail `PILOT_CONCURRENT_INVOCATION`.
- Closed ledger cannot run.

## Timeout behavior

- One source deadline and one global deadline. Wait is `min(source remaining, global remaining)`.
- AbortController abort and body-reader cancel are explicit failures: `PILOT_SOURCE_TIMEOUT` / `PILOT_GLOBAL_TIMEOUT` / `PILOT_TIMEOUT`.
- Valid JSON then a stalled stream fails closed; the reader is cancelled with `timeout`.
- Oversized bodies cancel with `oversized` and fail `PILOT_BYTE_LIMIT`.
- Unused redirect/error bodies are cancelled before following or retrying.

## Receipt generation

- Unique attempt IDs and capture names; earlier evidence is not overwritten.
- Capture success, identity, release, and acceptance eligibility are separate.
- Validated receipts are written in full under `pilot-receipts/`. Failed identity receipts persist the complete object with `bounded_sample=false`, `supported=false`, and the validator code as `status` — they no longer claim a bounded sample.
- R04 counts require `_release_check.status === 'verified'` **and** `live_http=true`. Unresolved FY_END_DT / PLACES year contribute 0. File-sample reanalysis of retained HCRIS bytes can derive identity under `Provider CCN` and still contributes 0.

## Findings addressed this round

1. Duplicate query parameters collapsed to the last value → `PILOT_URL_DUPLICATE_QUERY` before follow.
2. `allowMissingLedger` could seed a zeroed ledger → option and `emptyLedger` removed.
3. Ledger `candidate_head` mismatch blocked later collector SHAs from using remaining budget without a reset → spent units persist across AUTH rebind; budget is not mutated by recording `execution_heads`.
4. Redirect loops could exhaust hops with no capture and no error → `PILOT_REDIRECT_LIMIT`.
5. Failed identity receipts still had `bounded_sample: true` → now false.

## Remaining collector limits (not treated as blockers for this PR)

- AUTH-PAYLOAD-PILOT in git still names execution SHA `2efafed`. A later live run on this branch still needs an owner rebind of AUTH to that HEAD **without** resetting the ledger.
- `now` is injectable for tests; production uses `Date.now`.
- Concurrency policy is file-lock on one host, not a distributed lease.

## Site

No application change this round. Completed Chromium evidence is preserved. Ranked discovery still requires JavaScript; no-JS `/search` is a title-token fallback only.
