# Independent review note — evidence validation repair and site next-action

Reviewer: Astra/root (engineering). This note **cannot grant owner authority**, accept R01–R16, execute payload retrieval, or change production.

Candidate branch: `codex/ushso-evidence-ingestion-20260915` (draft [PR 105](https://github.com/ajhcs/ushso/pull/105)). Frozen `evaluation/research-program/cohorts.json` sha256 `89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543` unmodified. Historical receipts preserved.

## Validator repairs

- Payload live HTTP requires an owner-authorized register entry that binds action, exact candidate SHA, product keys, endpoints, limits, and credentials. A receipt containing `{"authorized": true, "id": "AUTH-PAYLOAD-PILOT"}` does not authorize itself. AUTH-04 is rejected for payload retrieval. The on-disk payload register currently has **zero** authorized entries.
- Sample identity and row fields come from `verification/research-program/evidence/product-sample-requirements.json`. Every captured row is checked. Frozen record_id and native_id are mandatory. Execution URLs must match authorized hosts/scope. Caller-supplied `_derived_*` flags are stripped and cannot bypass checks. CSV is rejected until a quoted-field parser exists.
- HCRIS `FY_END_DT` and PLACES `year` remain **unresolved** as catalog-release proof. Frozen local documentation does not establish those semantics. The pilot packet no longer forces a guessed year.
- Observation windows cannot end in the future, even by one hour. Start cannot precede deployment. Cycles require environment, deployment id, candidate head, unique scheduler-run IDs, and after-refresh evidence bound to the receipt SHA-256. Missing bindings fail closed.
- Evidence bytes are hashed on every read. Changing bytes at the same path invalidates a prior digest.

File fixtures remain usable as tests. They do **not** count toward R04 public-sample totals (`live_http` required for engineering sample counts).

## Site

Every source now has a next action from bound publisher URL or a typed missing-URL state. Result cards keep the six `data-result-region` values, say catalog membership is not payload access, and keep "Open access route". HCRIS-only landing-page copy was removed from SourceSummary.

These are engineering observations, not 8+8 participant evidence.

## Pilot

Prepared, not executed. Conditional owner approval exists only after this review of the validator repairs. Do not fetch HCRIS or PLACES under this commit.

## Not claimed

R01–R16 acceptance, 80 payload samples, restricted routes, 14 elapsed days, two scheduled cycles, AT/browser evidence, C-009-1 topology, AUTH-12, production change, scientific approval, program completion.
