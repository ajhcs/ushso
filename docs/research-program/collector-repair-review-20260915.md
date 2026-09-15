# Independent engineering review — collector repair and qualification boundaries

Reviewer: Astra/root (engineering). This note cannot grant owner authority, accept R01–R16, spend remaining publisher requests, or change production.

Candidate branch: `codex/ushso-evidence-ingestion-20260915`. Frozen `cohorts.json` unmodified. Original HCRIS failed attempt preserved.

## Collector

- Budget is persisted to `payload-retrieval-pilot-ledger.json` before each hop (initial, redirect, retry). Empty remaining budget fails closed at run start.
- Redirects must match the product’s approved endpoint, not merely an allowed hostname.
- Body reads keep the timeout; oversized bodies cancel.
- Each attempt writes a unique attempt record and capture name. Failed identity still retains capture bytes.
- Capture success, identity verification, release verification, and acceptance eligibility are separate fields.
- R04 sample totals require `_release_check.status === 'verified'`. Unresolved PLACES year contributes zero qualified samples.
- Mock-transport tests cover restart, duplicate invocation, cross-source redirect, stall, oversized body, and HCRIS identity failure. They are not operational evidence.

## Remaining uncertainty

The two live GETs on `2efafed` still stand: HCRIS identity failed (`Provider CCN` vs `PROVNUM`); PLACES identity passed with unresolved year. No additional publisher requests were made during this repair. Remaining budget: 2.

## Site

Chromium 149 via Playwright walked search → details → empty → missing → 360px mobile. Details pages now offer a source evidence packet download. No-JS `/search` lists catalog titles and states ranked discovery needs JavaScript. PNGs gitignored; `notes.json` committed.
