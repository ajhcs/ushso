# Independent review request — draft PR 105

Please review draft [PR 105](https://github.com/ajhcs/ushso/pull/105) as an independent engineering reviewer. This request does **not** grant owner authority, accept R01–R16, authorize payload retrieval, or change production.

## Scope

- Evidence ingest rejects stale/duplicate/mismatched/incomplete/`accepted=true` receipts.
- R04 false-success regressions: catalog membership, vintage substitution, fictional MRF walkthroughs, family workflows, and bounded samples without `payload_success` must fail closed.
- Frozen `evaluation/research-program/cohorts.json` sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543` unmodified.
- Historical receipts under `verification/research-program/evidence/history/` preserved.
- Payload-retrieval pilot packet is prepared and **not authorized**. AUTH-04 does not cover payload retrieval.

## Calculated outcomes (must remain)

- R04 payload-sample complete 0/80
- Restricted routes verified false
- `r04_accepted=false`
- Unknown essential cells 0 (known-unsupported, not unknown)
- Program complete false

## Do not

- Merge PR 105
- Convert the draft to ready-for-review unless the reviewer asks
- Invent 8+8 participants, 14 days, two cycles, AT/browser evidence, C-009-1 topology, AUTH-12, or production rollout
- Execute the retrieval pilot

Reviewer identity for this engineering packet remains Astra/root unless a named human reviewer is assigned.
