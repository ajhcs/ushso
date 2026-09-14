**Inventory for PR-001 C-001-2 only.** Not implementation, activation, or whole-program acceptance.

**Git identity (this worktree):** HEAD `c92465f97df11a1e231983237f27e8c86db792b2`, parent `45210704b8de2d7b1360b6d32657cd17791bdd77`, tree `5c6d64f4e18b19482226dca2bd02ab1dbd6d9d08`, branch `codex/ce-ushso-pr001-boundary-rev-grok-boundary-inventory-3a6e1d0b4e44-d50f2a31`.

**Provider/model:** runtime identity is Grok 4.6 (xAI). Assignment envelope said `grok` / `grok-4`; that was not separately verified.

**Authorization class:** parent register `verification/external-authorization/v1.0.0/register.json` digest `335b7d3516594d2372cc545b16bf6bbc18e7f69420b4485f659b52a1cdff923b` matches the v1.1.0 parent pin. Effective successor is v1.1.0 with one historical AUTH-10 delta. AUTH-10 `expires_at` is `2026-09-04T16:00:00Z` and is scoped to `ajhcs/ushso` branch `codex/research-navigator-integration`; it does not cover this branch, merge, production, live sources, or planner/identity enablement.

| boundary_id | evidence | remains disabled/restricted | destination | historical vs effective |
|---|---|---|---|---|
| ADR-0001 product/truth | `docs/adr/0001-product-and-truth-boundary.md:63-91`, `:95-105`, `:185` | Public request path must not harvest, fetch source payloads, mutate identity, grant authorization, run analysis, or enable planner/machine-toolkit until gates pass. Envelope fields stay `false`. | **Retain.** Consume: PR-009 (no-source-egress), PR-022 (no Worker LLM), PR-058/PR-062 (planner stays off), PR-029/PR-034 (identity merge review). | Effective product invariant. Implementation still `in_progress`. |
| ADR-0004 PG canonical + immutable publication | `docs/adr/0004-postgresql-cloudflare-and-immutable-publication.md:33-46`, `:176-205`, `:318-335` | PostgreSQL is canonical; search/R2 are not. Failed/partial builds cannot replace last-good publication. No Neon/Cloudflare procurement, secrets, apply, or traffic from this ADR. | **Retain architecture.** Reconcile cost/topology in PR-009 successor ADR. Public generations: PR-021, PR-030. Recovery: PR-078. Cutover/soak: PR-082–PR-084 + AUTH-06–09/11. | Effective architecture; not production authorization. |
| ADR-0004 payload retention | `docs/adr/0004-…md:36-38`, `:146-174` | R2 may hold bounded metadata/docs only. No source dataset payloads, healthcare rows, credentials, cookies, auth material, or secret URLs. Default raw-capture retention 90 days; security/audit ≥1 year. | **Retain until explicit successor.** PR-009 must not introduce retained payload storage without a new ADR. PR-078 verifies retention classes. | Effective restriction. MASTER-PLAN.md:23 names this as a PR-009 reconciliation, not a waiver. |
| ADR-0004 worker/role denials | `docs/adr/0004-…md:106-119`; `worker/static-entry.mjs:1-9`; `wrangler.jsonc:5` | `ushso-public` denied connector creds, source egress, R2 writes, queues, canonical writes. Current deployable Worker is static ASSETS-only. | **Retain.** PR-010/PR-076 may compose scheduler/harvest but must keep production composition disabled until AUTH. | Effective current runtime. |
| ADR-0005 search non-truth | `docs/adr/0005-…md:29-59`, `:78-79` | Search projections `source_of_truth: false`. Target public path must not load JSONL. `StaticSearchBackend` is emergency/fixture only. | **Retain target.** Current JSONL Worker is the live/emergency path until AUTH-09. PR-009/PR-030/PR-077. | Historical current runtime vs target. Do not treat JSONL as canonical. |
| ADR-0000 public/control-plane split | `docs/adr/0000-…md:77-88`, `:99-105` | Public Worker must not import connectors, source clients, R2 writes, queues, or workflow mutation. Migrations forward-only; rollback is publication/static, not down-migration. | **Retain.** PR-010/PR-076/PR-078. AUTH-09 blocks JSONL retirement. | Effective. |
| ADR-0002 contract immutability | `docs/adr/0002-…md:36-54` | Released contract dirs are never edited in place. | **Retain.** Additive versions via PR-008/PR-058. | Effective. |
| ADR-0003 identity merge | `docs/adr/0003-…md:73-91`, `:155-158`; `packages/identity/manifests/package-manifest.json:37-41`; `packages/identity/validation/validation-receipt.json:11-16` | Automatic identity resolution disabled by default (`disabled_candidate_only`). `identity_merges_performed: false`. No public-request merge. Name/embedding similarity cannot prove equality. | **Retain.** PR-034 (no automatic name-based merge), PR-029, PR-035, PR-051. AUTH-14/AP-06 still unauthorized. | Effective. Local fixtures ≠ adjudication. |
| ADR-0003 join no-upgrade | `docs/adr/0003-…md:141-144` | Legacy 14 join routes stay candidate/ambiguous/unknown/blocked unless evidence satisfies new states. | PR-036; do not silently upgrade. | Effective. |
| ADR-0006 historical retrieval schema | `docs/adr/0006-…md:24-48` | Historical schema bytes/digest unrecovered; successor validates locally only. PASS ≠ recovered historical schema. | **Retain pin.** No destination PR rewrites it. | Historical pin + local successor. |
| ADR-0007 WP14 attestation | `docs/adr/0007-versioned-wp14-successor-attestation.md:7-35` | WP14 v1.0.0 sealed. v1.1.0 is additive local/CI only. No deploy, provider mutation, release-gate, or production-eligibility claim. | **Retain.** Release qualification is PR-082; not this ADR. | Successor of WP14 v1.0.0; still not release authority. **Omission:** not in `docs/adr/README.md` index. |
| AUTH-01..09, AUTH-11 | `verification/external-authorization/v1.0.0/register.json:7-104`; `docs/RELEASE_GATE_AND_AUTHORIZATION_RECONCILIATION.md:232-236`, `:388-395` | All `not_requested` / `authorized: false`. Blocks paid Neon/CF, secrets/Access, staging/prod apply, live metadata canary, recovery drills, internal canary, public cutover, soak, JSONL retirement, zero-traffic prod foundation. | **Retain unauthorized.** Map without activating: AUTH-01/02/03/11 → PR-009 then PR-077/078/082; AUTH-04 → PR-010/011/012 (fixture first); AUTH-05 → PR-078; AUTH-06/07 → PR-082/083; AUTH-08/09 → PR-084 / AUTH-09. | Parent remains effective denial. RELEASE_GATE snapshot SHAs (`c680fb6b…`) are historical, not this HEAD. |
| AUTH-10 | `verification/external-authorization/v1.1.0/register.json:10-26`; `…/v1.1.0/README.md:3-8` | Historical scoped git push/draft-PR only; expired `2026-09-04T16:00:00Z`; excludes merge, production, held-out eval, live connectors, external co-engineer exposure. | **Retain parent denial for this branch.** Not a PR-001/production authorization. New git publication needs a fresh AUTH-10 (or successor) if required. | Historical successor, not currently effective for this worktree. |
| AUTH-12 / AP-02 planner governance | `…/v1.0.0/register.json:106-113`; RELEASE_GATE `:264-272` | No WP10B `/api/plan` activation or live compiled-plan injection. | PR-058 keep disabled; PR-062 gated enablement **after** AUTH-12. | Effective denial. |
| AUTH-13 / AP-05 holdout | `register.json:115-122` | No protected-holdout scoring or final retrieval-pass claim. | PR-039; close at PR-079/082. | Effective denial. |
| AUTH-14 / AP-06 identity adjudication | `register.json:124-131` | No production auto-resolution enablement; no “uncertain identities were adjudicated.” | PR-034/PR-042; still AUTH-14. | Effective denial. |
| AUTH-15 / AP-07 coverage wording | `register.json:133-139` | Preview wording is not approved exhaustive coverage. | PR-002/PR-030; AUTH-15 retained. | Effective denial. |
| AUTH-16 / AP-03 usability | `register.json:141-148` | No beta usability claim. | PR-080. | Effective denial. |
| AUTH-17 / AP-04 expert review | `register.json:150-157` | No expert-reviewed Use-Card/Access Plan claim. | PR-033/PR-042/PR-041. | Effective denial. |
| AP-01 principal-binding | RELEASE_GATE `:240-262` | No production use of caller-supplied principal/audit identity. Local hardening ≠ authenticated principal source. | **Retain.** No plan.json PR owns AP-01 as an AUTH ID. | Effective blocker; packet pending. |
| AP-08..12 | RELEASE_GATE `:329-385` | No paid provisioning, live canary, public cutover, soak, or JSONL retirement. | PR-077/078/082/083/084 + matching AUTH. | Request-ready, not authorized. |
| WP4_SCHEDULER_COMPOSITION_DISABLED | `services/scheduler-worker/worker.mjs:3-16`; `…/README.md:3-10` | Default export throws; no bindings/DB/provider at import. | PR-010 (keep disabled); PR-076 named activation **after** tested artifact + AUTH. Merging config is not enablement (`plan.json` PR-076 acceptance). | Effective. |
| WP4_HARVEST_COMPOSITION_DISABLED | `services/harvest-worker/worker.mjs:3-32`; `…/index.mjs:18-19` | Default queue retries with `WP4_HARVEST_COMPOSITION_DISABLED`; `Workflow: null`; no source request at init. | Same as scheduler: PR-010/PR-076; AUTH-04 for live egress. | Effective. |
| static public composition | `worker/static-composition.mjs:8-22`; `worker/index.mjs:83-87`, `:218-220` | Public query service is static catalog/search/coverage/planner ports over ASSETS JSONL. | Retain as current/emergency runtime. PR-030/PR-077 may measure transition; AUTH-09 retires JSONL. | Effective current path. |
| plan_research disabled | `packages/machine-toolkit/src/manifest.mjs:23`, `:53-64`; `worker/machine-toolkit-router.mjs:237-250`; `worker/static-machine-toolkit-service.mjs:488-490`; `packages/planner/static-planner-repository.mjs:7-14` | `plan_research` flag false; `disabled_pending_gates`; static planner throws `planner_unavailable`; caller activation forbidden; no source egress/acquisition. | PR-058 keep disabled; PR-062 prepare gated evidence only. AUTH-12 required to enable. | Effective. |
| no request-path LLM | MASTER-PLAN.md:45 (`R14`); `plan.json` PR-022 C-022-3 `:1763`; PR-022 acceptance `:1767` | No model in public request handling. Paid calls remain disabled until budget/key provisioned. | PR-022/023/024; **retain off** on public Worker. | Effective; adapter not yet the program PR. |
| no request-path source collection | ADR-0001:63-65; MASTER-PLAN.md:75; PR-009 acceptance `plan.json:1017` | Collectors stay off the public request path. Public no-source-egress remains enforced. | PR-009/PR-010/PR-076. Do not add a public crawl endpoint because scheduler/harvest are disabled. | Effective. |
| product-boundary envelope | `tests/product-boundary.test.mjs:12-18`; ADR-0001:95-105 | `source_requests_made`, `execution_authorized_by_ushso`, `retrieval_executed`, `payloads_acquired`, `analysis_executed`, `identity_merges_performed` forced false. | **Retain** across PR-055–PR-063 surfaces. | Effective contract. |
| scientific/dictionary review flags | `wrangler.jsonc:31-37`; `worker/index.mjs:237`; routers 404 unless `=== "enabled"` | Flag-gated review endpoints; scientific notes excluded from public eight-tool contract. Committed production wrangler currently sets the three flags `enabled`. | Map review workflow to PR-028/PR-029. **Not** planner or identity-merge enablement. | Current config enables review routes; code comments still say disabled-by-default. |
| exact release/approval scope | PR-001.md:47-48, `:57`; EXECUTION.md:91-94; plan.json status `proposed_not_implemented` | Existing release and scientific approval receipts stay unchanged. Plan package does not authorize new infra or paid calls. PR-082 is the exact-candidate gate; PR-083 needs separate production authorization. | PR-001 records base; PR-082 qualifies; PR-083/084 + AUTH-06–09 execute only after owner packets. | This HEAD is a planning commit on the production parent, not a release pass. |

```json
{
  "candidate_head": "c92465f97df11a1e231983237f27e8c86db792b2",
  "production_parent": "45210704b8de2d7b1360b6d32657cd17791bdd77",
  "tree": "5c6d64f4e18b19482226dca2bd02ab1dbd6d9d08",
  "provider_model_runtime": "Grok 4.6",
  "auth_parent_sha256": "335b7d3516594d2372cc545b16bf6bbc18e7f69420b4485f659b52a1cdff923b",
  "effective_auth": "v1.1.0 overlays expired AUTH-10 only; AUTH-01..09 and AUTH-11..17 remain unauthorized",
  "must_preserve": [
    "payload-retention prohibition (ADR-0004 / PR-009 successor required before any sample store)",
    "immutable publication and last-good generation (ADR-0004 / PR-021 / PR-030)",
    "PostgreSQL canonical truth; search/JSONL non-authoritative (ADR-0004/0005)",
    "no request-path LLM or source collection (R14, ADR-0001, PR-022, PR-009)",
    "planner disabled (plan_research / AUTH-12 / PR-058 / PR-062)",
    "identity auto-merge disabled (ADR-0003 / AUTH-14 / PR-034)",
    "exact release/approval scope (AUTH register + PR-082/083; this inventory is not activation)"
  ]
}
```

**Actionable omissions / conflicts for PR-001 mapping**

1. `docs/adr/README.md` indexes ADR 0000–0006 only; ADR 0007 exists and must be retained as a successor attestation, not dropped.
2. `docs/RELEASE_GATE_AND_AUTHORIZATION_RECONCILIATION.md:232-236` still calls v1.0.0 the authoritative register with AUTH-01–17 all `not_requested`. Effective successor is v1.1.0. Do not copy the stale sentence as current AUTH-10 state.
3. `verification/external-authorization/v1.1.0/tools/effective-register.mjs` overlays AUTH-10 as `authorized_scoped` and does **not** enforce `expires_at`. As of 2026-09-10 that delta is expired and was never scoped to this branch.
4. ADR 0005 forbids public JSONL loading; the deployed Worker still loads ASSETS JSONL. Map as **retained current/emergency runtime**, not as a silent architecture waiver. Retirement remains AUTH-09.
5. PR-009 is the only planned ADR successor and may change Neon class / storage topology; it must list superseded ADR clauses and **cannot** authorize paid resources or new retained payloads.
6. AP-01 has no AUTH ID and no plan.json owner path. Leave as explicit retained constraint.
7. Historical release-gate failures (`c680fb6b…`, `40f44fc9…`) and WP14 pins (`f6edbb0` / `f2641a3`) are not this HEAD. PR-001 baseline must not mix those candidates.
8. `wrangler.jsonc` enables scientific/dictionary/conflicts review while comments/tests describe disabled-by-default. Record the committed flag state; do not treat it as planner or payload activation.

Did not read credential/env/host-note/raw-audit files. Did not fetch sources, run production tests, or change files.