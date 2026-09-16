# Owner YES — research-branch candidate, PR 105 stays draft — 2026-09-16

This records the owner answer **YES** to the engineering-readiness question. It does **not** authorize production, staging, scheduler activation, scientific acceptance of R01–R16, HHA/Census expansion, or spending the remaining publisher requests.

## Decision, as granted

Treat draft [PR 105](https://github.com/ajhcs/ushso/pull/105) as the **research-branch collector / validator / site candidate** after gated SHA `2a72184`, with:

- PR 105 **stays draft** (not ready, not merged)
- Remaining publisher budget **2 unused**
- R04 **unaccepted** (0/80)
- Frozen `evaluation/research-program/cohorts.json` unmodified (sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543`)
- Original failed HCRIS live attempt preserved (`live_payload_identity_mismatch` under then-required `PROVNUM`)

## Exact SHAs

| Role | SHA |
| --- | --- |
| Gated engineering candidate | `2a7218434e675bff4916853f968fdc350c63e288` tree `ab59fb7aa97d2810a56e8ac242423da3a4ef6b2d` |
| Local gate | `20260916T132336Z-365962153af4` passed (823.707s). Receipt 21,850,479 bytes sha256 `10e6604b…` off-tree |
| Hosted CI | [35101601431](https://github.com/ajhcs/ushso/actions/runs/35101601431) success on `2a72184` |
| Pointer-only commit after that gate | `b3c45c3d07f18602805303f227e31a78e05f71f7` |
| Pilot live execution (spent 2/4) | `2efafed96104012da2d17ec14d8a93c5b33a3d25` |
| AUTH-PAYLOAD-PILOT still names | `2efafed` — a later live run still needs an owner rebind **without** resetting the ledger |

Do **not** describe `361a4a2` or `de47ff0` as validation of this tree.

## Explicitly not granted

- Mark PR 105 ready for review as a production change, or merge it
- Production / staging deploy, scheduler, AUTH-12
- Scientific acceptance
- Spending the remaining 2 publisher requests
- Treating file-sample HCRIS reanalysis as a live R04 sample
