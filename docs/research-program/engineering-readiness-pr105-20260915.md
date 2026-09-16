# Engineering-readiness summary — draft PR 105

This is **not** scientific acceptance, **not** production authorization, and **not** a request to mark PR 105 ready.

Branch `codex/ushso-evidence-ingestion-20260915`. Frozen `cohorts.json` sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543`. Remaining publisher budget **2 unused**.

## What could be integrated into research (engineering only)

Safe to land on the research ingest branch, still as a **draft** PR:

1. **Evidence ingest validators** — catalog metadata is not a payload sample; every row checked; hash-on-read; AUTH register required for live HTTP; observation fail-closed on future windows and missing bindings.
2. **Payload collector** — durable ledger, one charge per issued request, source+global deadlines, exclusive lock, product-scoped URLs including query maps and duplicate keys, cancelled unused bodies, complete receipts. Mock-transport tests only; no live HTTP in CI.
3. **HCRIS identity amendment** `HCRIS-IDENTITY-PROVIDER-CCN-20260915` — required field is live/dictionary **Provider CCN**, not PBJ `PROVNUM`. Original failed live attempt preserved. File-sample reanalysis of retained bytes derives identity and still contributes **0** R04 samples because release is unresolved and `live_http` is false on the reanalysis receipt.
4. **Site** — generic next action, source evidence packet download, no-JS title-token fallback (not ranked search), crawler dataset HTML. Chromium walkthrough already recorded.

Do **not** integrate as if they were true:

- R04 80 public bounded samples (still **0/80**, `r04_accepted=false`)
- Restricted-route verification
- Production/staging deploy, scheduler, AUTH-12
- A live HCRIS sample under the amended field (that would be a **new** retrieval against remaining budget)

## What remains research-blocked

- PLACES `year` and HCRIS Fiscal Year End Date vs named catalog releases
- 8+8 humans, 14 days, two cycles, C-009-1 topology
- Firefox/WebKit/AT
- Remaining 2 publisher requests (unused)

## Decision needed to move PR 105 forward

**Engineering merge-readiness of the draft, not production and not R01–R16.**

Ask a named human: *May draft PR 105 stay draft but be treated as the research-branch collector/validator/site candidate after `af73b02` + this collector-hardening commit, with remaining publisher budget 2 unused and R04 unaccepted?*

Separate, later, not this decision:

- Production deploy
- Scientific acceptance
- Spending the remaining 2 requests
