# WP14 v1.1.0 evidence ledger

| Requirement | Implementation evidence | Verification receipt |
| --- | --- | --- |
| Bind only the authorized fixture CAS change | Policy pins commit `f2641a3bfd5ae7249d0acffff883b312e4bdb077`, tree `dc80d1c0f9ff7d8c4a2a4a8beb01ed2723878675`, both Git blob OIDs, and both SHA-256 digests | `source-blob`, `source-sha256`, and `source-bytes` checks in `receipts/successor-attestation.json` and `npm run validate` |
| Preserve WP14 v1.0.0 | The v1.1.0 package is additive; the v1.0.0 source and test are restored to the frozen implementation manifest | `historical-v1-manifest-file`, `historical-v1-package-preserved`, and six historical receipt checks |
| Do not repin or overwrite historical evidence | Policy sets both historical mutation permissions to false; the successor receipt records `repinned:false` and `overwritten:false` | Raw historical receipt SHA-256 bindings and canonical-digest checks |
| Exercise fixture CAS, serialization, failure injection, replay, and durability boundaries | Exact authorized source and regression-test blobs run through versioned compatibility bridges | `npm test --prefix verification/wp14/v1.1.0`: 12/12 passing |
| Keep external authorization closed | The verifier reads the authorization register and requires every entry to remain `not_requested` / `authorized:false` | `external-authorizations-remain-false`: 17 entries |
| Perform no production or provider action | Policy forbids deployment, provider mutation, production action, and release-gate execution | Receipt action counters are all zero; `zero-action-boundary` passes |
| Make no production-eligibility claim | Policy and receipt both set production eligibility false | `not-production-eligible` passes |
| Preserve the failed release-gate record and do not rerun it | Successor receipt records `executed:false` and `historical_failure_preserved:true` | `release-gate-not-executed` passes; historical run remains `20260831T170024Z-3003695ba806` |

This ledger describes local fixture evidence only. It is not authoritative
transactional-store, managed recovery, live-traffic, release-gate, or
production evidence.
