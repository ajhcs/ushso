# Next owner decision packet — 2026-09-15

This packet does **not** authorize production, paid services, scheduler activation, HHA/Census expansion, or R01–R16 acceptance.

## Exact candidate

- Branch `codex/ushso-evidence-ingestion-20260915`
- Pilot execution SHA: `2efafed96104012da2d17ec14d8a93c5b33a3d25`
- Record SHA (this packet/commit): current HEAD after recording receipts
- Draft [PR 105](https://github.com/ajhcs/ushso/pull/105) remains draft
- Frozen `evaluation/research-program/cohorts.json` sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543`

## What passed, bound to SHAs

- Local exact-tree gate `20260915T182042Z-bfd9930f0aa3` **passed** on `de47ff0` / tree `85941327`. Receipt 21,848,833 bytes sha256 `d6a6d647…` stays off-tree.
- Hosted CI [35006885731](https://github.com/ajhcs/ushso/actions/runs/35006885731) **success** on `de47ff0`.
- Focused ingest/qualify-core/pilot tests passed on AUTH rebound to `2efafed` before execution.

Do **not** describe the earlier `361a4a2` gate as validation of this tree.

## What was collected

Two public JSON GETs, 2 of 4 authorized requests, 0 redirects, no credentials.

| Product | Result | Bytes | Rows | live_http | Counts as R04 sample |
| --- | --- | ---: | ---: | --- | --- |
| HCRIS hospital cost report UUID `44060663-47d8-4ced-a115-b53b4c270acb` | **identity failed**: live field is `Provider CCN`, required frozen field is `PROVNUM` | 20751 | 5 | true | no |
| CDC PLACES `swc5-untb` | identity passed on `stateabbr`; **release unresolved** (year semantics) | 3194 | 5 | true | engineering derived sample on this capture, **R04 still unaccepted** |

Frozen identity was not changed after seeing the response. Publisher bytes remain gitignored under `verification/research-program/evidence/payloads/pilot-r04/`. In-tree receipts bind their SHA-256.

Remaining authorized budget on this instruction: **2 requests**, 2 unused.

## Site

Users can now see a next action on every source page (SPA) and on no-JS dataset crawler HTML: open the bound publisher URL, or a typed missing-URL state. Result cards still say catalog membership is not payload access and keep six `data-result-region` values. Chromium/Firefox/WebKit and AT remain untested.

## Remaining incomplete

- R04 **0/80**, restricted routes **false**, `r04_accepted=false`
- HCRIS dictionary field `PROVNUM` vs live CMS API `Provider CCN` is unresolved as a *schema* question, not solved by renaming after the fact
- PLACES year vs 2025 county-table release remains unresolved
- 8+8 participants, 14 days, two cycles, C-009-1 topology, AUTH-12, production

## Decisions requested

1. Keep PR 105 draft (recommended) until a named human reviews validator integrity and the HCRIS field mismatch.
2. Whether to treat CMS `Provider CCN` as a reviewed product-definition amendment for a *later* retrieval, not this already-spent HCRIS attempt.
3. Whether to spend the remaining 2 requests on a retry of the same two endpoints, or leave the budget unused.
4. Production/staging/scheduler remain **not requested**.
