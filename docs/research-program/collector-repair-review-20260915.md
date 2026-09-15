# Independent engineering review — collector repair (exact budget/timeout) and HCRIS identity

Reviewer: Astra/root (engineering). This note cannot grant owner authority, accept R01–R16, spend remaining publisher requests, or change production.

Candidate branch: `codex/ushso-evidence-ingestion-20260915`. Frozen `cohorts.json` unmodified. Original failed HCRIS live attempt on SHA `2efafed` preserved. Remaining publisher budget: 2 unused.

## Collector (actionable findings addressed)

- Timeout cancellation is an explicit failure: `PILOT_TIMEOUT` / `PILOT_SOURCE_TIMEOUT` / `PILOT_GLOBAL_TIMEOUT`. Stalled body after valid JSON fails closed.
- One absolute deadline per source and one global deadline; remaining wait is the min of both.
- Each issued GET (initial, redirect hop, retry fetch) charges exactly one budget unit before the request is sent. A 503 then success uses two units.
- Concurrent invocations take an exclusive lock file; the second fails `PILOT_CONCURRENT_INVOCATION` and cannot spend the same remaining units.
- Missing ledger is `PILOT_LEDGER_REQUIRED` (no empty-ledger recovery that would reset spent budget). Inconsistent remaining/used totals fail closed.
- Redirect destinations must match the product’s approved endpoint **including query parameters**. `size=50` is rejected before follow.
- Unused redirect/error bodies are cancelled.
- Complete receipts are persisted under `verification/research-program/evidence/pilot-receipts/`, not only IDs.
- R04 sample totals still require verified release. Unresolved PLACES year / HCRIS FY_END_DT contribute zero qualified samples.

Mock-transport tests are not operational evidence.

## HCRIS identity

Local hospital cost-report dictionary names **Provider CCN** (CMS Certification Number). Live retained JSON uses that field. `PROVNUM` is a PBJ staffing dictionary term, not this product’s JSON identity. Amendment `HCRIS-IDENTITY-PROVIDER-CCN-20260915` is applied to sample requirements and VariableBrowser. It does not rewrite the original failed live attempt.

## Site

Chromium 149 walked the rebuilt candidate: search receipt download, source evidence packet download, keyboard search→details→return (query and hash restored; gold 3px `:focus-visible`), 360px no overflow, empty/missing recovery, and JavaScript-disabled title fallback with token matching. Ranked discovery still requires JS.
