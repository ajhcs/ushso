# Independent review note — evidence ingestion / R04 catalog binding

Reviewer: Astra/root (engineering). This note **cannot grant owner authority**, accept R01–R16, authorize payload retrieval, or change production.

Candidate: research ingest branch `codex/ushso-evidence-ingestion-20260915` (draft [PR 105](https://github.com/ajhcs/ushso/pull/105)). Frozen generation `live-2026-09-03-85b50522b420`. Frozen `evaluation/research-program/cohorts.json` sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543` unmodified.

## Technical conclusions

- Receipt ingest rejects stale, duplicate, mismatched, incomplete, and `accepted=true` receipts.
- Catalog membership, vintage substitution, fictional/synthetic walkthroughs, and family workflows cannot count as bounded samples or verified routes.
- Bounded samples now require `payload_success`, native product ID, and release ID. Live HTTP remains forbidden in receipts.
- Current calculated R04: unknown essential cells 0, payload-sample complete 0/80, restricted routes verified false, `r04_accepted=false`. Failed matrix retained.
- Historical receipts under `verification/research-program/evidence/history/` are preserved.

## Payload-retrieval pilot

Packet `verification/research-program/evidence/payload-retrieval-pilot.json` is **prepared, not authorized**. AUTH-04 does not cover payload retrieval. Pilot products are HCRIS hospital cost report and CDC PLACES `swc5-untb` only. PLACES `7cmc-7y5g` is forbidden. Census 2024 and HHA are later expansions.

This review does **not** request or grant payload-retrieval authorization.

## Remaining owner decisions

1. Keep PR 105 draft until independent review of this note and the regressions.
2. Record a distinct payload-retrieval AUTH packet before any live request in the pilot.
3. Keep R04 unaccepted until 80 public bounded samples and remaining verified routes actually hold.
