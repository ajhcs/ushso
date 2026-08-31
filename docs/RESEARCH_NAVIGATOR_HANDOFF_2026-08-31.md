# Research Navigator implementation handoff — 2026-08-31

## Checkpoint status

This is a safe, resumable checkpoint, not a Definition-of-Done declaration.

- Codex goal `01a0546e-54f4-7190-9065-ec3db37f2bb7` stopped automatically with status `usageLimited` after 2,865,720 tokens and 11,264 seconds.
- All subagents are stopped. No background implementation or validation process is expected to be running.
- No production deployment, remote push, paid-infrastructure action, live connector harvest, or irreversible external action was performed.
- The worktree is intentionally dirty and uncommitted. Preserve it as the implementation checkpoint.
- Local `HEAD` is `6eeca2a47d4dba7eee05e9b43b15fa03f231ac6a` (`Make Observatory discovery backend-driven and verifiable`). The local `origin/main` ref is one commit ahead at `e93ac2b5ad66cc6528182cced7e95fb3929841a9` (`Tighten result cards, bounded counts, and live provenance (#2)`). Do not pull or rebase this large dirty tree without first reviewing the upstream delta and protecting the checkpoint.
- `RELEASE_PROVENANCE.json` and `.serena/` predated this program's edits and must continue to be treated as user-owned/unrelated unless proven otherwise.

The authoritative specification remains `docs/RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md`. The product boundary is unchanged: USHSO recommends, explains, and compiles evidence-bound research plans; it does not execute analyses, calculate market share, produce financial benchmarks, or become a general analytics application.

## Tracked workstream position

The execution plan at this checkpoint is:

1. WP0 source capture, hash verification, and paragraph-level reconciliation: implemented and locally verified; final aggregate reseal remains a final-freeze action.
2. WP1–WP2 contracts, ADRs, v1 compatibility, and shared semantic boundaries: implemented and locally verified; aggregate receipts must be regenerated after the tree freezes.
3. WP3–WP4 persistence and ingestion control plane: in progress. Migrations `0001`–`0003`, database tooling, scheduler/harvest worker entrypoints, workflow contracts, retry/DLQ/outbox policies, and WP4 verification sources exist. The package has not been finally reviewed, database-integrated, or sealed.
4. WP5 connector framework and delivery waves: reopened and materially expanded. Metadata-only ArcGIS, Dataverse, DataCite, OAI-PMH, CKAN, Socrata, Data.gov, CMS, Census, static inventory, and regulator/APCD dispatcher sources and fixtures exist. The final ingestion-v1.1 descriptor compatibility change and complete wave validation were interrupted before freeze.
5. WP6 canonical normalization and persistence: in progress. Migrations `0004`–`0007`, import/projection logic, source-observation reconciliation, and PostgreSQL verification harness sources exist. Final transaction/concurrency/closure review, WP4 migration binding, database run, and seals remain incomplete.
6. WP7 identity/family/version grouping: local non-database package and evaluation work exists; human adjudication authorization and migration integration remain outstanding.
7. WP8 immutable production search generations: local untuned candidate exists; protected held-out tuning authorization and database/generation integration remain outstanding.
8. WP9 public coverage accounting: local 306-cell/14-scope/157-record accounting package exists; final wording authorization and upstream generation binding remain outstanding.
9. WP10A public Use Cards/Access Plans: local deterministic candidate exists. WP10B planner implementation remains intentionally prohibited until planner-governance authorization.
10. WP11 researcher-facing UI: local candidate and tests exist; required researcher and expert-review studies are not complete.
11. WP12 bounded WebMCP/JSON toolkit: protected, unwired local candidate exists; it remains non-public and unauthenticated pending its dependencies and cutover authorization.
12. WP13 web discoverability/foundation: security and integrity repairs were written after an independent audit, including fail-closed digest recomputation, canonical-origin binding, secret-path rejection, public-locator/redaction provenance, `Vary: Accept`, and an independent DCAT 3 fixture. These changes were not independently revalidated or finally resealed after the interruption.
13. WP14 cutover/retirement: substantial state-machine, schema, durable-transition, CAS/ledger, rehearsal, and rollback hardening sources exist. The final independent audit, full test repetition, and reseal were interrupted.
14. Final freeze, security scan, release gate, rollback rehearsal, aggregate evidence ledger, and Definition-of-Done demonstration: not started against an exact frozen candidate.

## Important implementation artifacts now present

- Versioned contracts: `contracts/core`, `contracts/ingestion`, `contracts/identity`, `contracts/coverage`, `contracts/publication`, `contracts/use-access`, `contracts/research-plan`, `contracts/machine-toolkit`, and `contracts/tooling`.
- PostgreSQL foundation: `db/migrations/0001_registry_sources_endpoints_scopes.sql` through `db/migrations/0007_assertions_relationships_temporal_history.sql`, role/bootstrap tooling, retention/partition policies, production-shaped fixtures, migration verification, archive/restore tooling, and job/outbox leasing queries.
- Runtime composition: `services/scheduler-worker`, `services/harvest-worker`, Cloudflare infrastructure manifests, and the refactored Worker/static composition modules.
- Connector implementation: `packages/connectors` with bounded network policy, origin governance, route manifests, capture protocol, adapters, fixture matrix, delivery waves, reconciliation audit, and regulator/APCD registry boundary.
- Domain packages: `packages/registry`, `packages/ingestion`, `packages/normalization`, `packages/identity`, `packages/search`, `packages/coverage`, `packages/planner`, `packages/machine-toolkit`, and `packages/web-discoverability`.
- Evaluation/verification: `evaluation/bridge`, `evaluation/harness/v2.0.0`, `evaluation/identity`, `evaluation/planner`, `verification/wp0` through `verification/wp14`, `verification/program`, `verification/external-authorization`, and the seven testing-strategy packages under `verification/testing`.
- UI/toolkit candidate: plan page, canonical plan renderer/export, coverage positioning, researcher guidance, external URL policy, plan API adapter, and bounded Observatory toolkit registration.
- Analysis-requirements import: exact upstream healthcare-toolkit revision `8700a2fffbd067da1c52818cce3b7c546b423296`; catalog SHA-256 `7f5c77645c8609021cc15ff7dd8a78d6d1edda75d79fa1d0753ed4534406b33c`; schema SHA-256 `655056e52884225a2568df65a35caec78ed8d20f32478cbc2a5cdb8eca49884c`; HHI requirement digest `78037d84f591b493b8c36897648e1172b774615b9d716cc964ce29413df9d2b6`.

## Last known verification state

These are receipts observed before the final interrupted agent edits. They are useful diagnostics, not final-freeze evidence; rerun them after reviewing and freezing the current tree.

Known green at the time recorded:

- `npm run test:retrieval`: passed all retrieval and analysis-use tests.
- `node --test tests/import-analysis-requirements.test.mjs`: 10/10 passed when run with the temporary Git-repository permissions it requires.
- `node scripts/run-contract-suites.mjs --suite wp4`: passed before the later service/database edits.
- Core v1, core v2, machine-toolkit, research-plan, and use-access contract test/validation pairs passed after excluding `node_modules` and `.git` from deterministic manifest walkers.
- CI verification previously passed with 11 contract packages, 19 verification suites, and 47 test files before later workspace and source drift.
- Web tests previously passed 17 files/91 tests and the web build completed before the later WP13 repairs.

Known red, stale, or intentionally unrun:

- `npm run test:worker` last reached 40/41 passing. Its sole observed failure was a stale `package-lock.json` missing the newly added `verification/testing/{contracts,connectors,control-plane,search,planner,web,machine-interfaces}` workspace links. More drift may now exist.
- `npm run validate --workspace @ushso/observatory-retrieval` is red because the historical v1.0.1 build depended on an unvendored sibling-workspace schema at `observatory/index/v1.0.0/schemas/observatory-record.schema.json`. The historical manifest pins its exact SHA-256 as `2d778a3125ba03c7504aad92e7154fdedf686db66619e439a6259ba883e162d9`, but the bytes were not found locally or in the AJHCS GitHub organization. Do not substitute a looser schema or falsely claim equivalence. Resolve this with an explicitly documented/versioned compatibility successor or recover the exact bytes.
- Ingestion v1.0/v1.1 manifests and receipts were deliberately left unsealed pending WP4 contract and migration freeze.
- WP4 has no final receipt; WP6 has no final receipt; both PostgreSQL suites remain to be run.
- WP13's prior seal is explicitly superseded; the live repaired candidate is provisional and unsealed.
- WP14 receipts may be stale relative to its hardening sources and require a clean independent audit and regeneration.
- The seven testing-strategy descriptors were created, but control-plane/web/machine-interface evidence was red against concurrent byte drift when last reported.
- The one-shot repository release gate was deliberately not run because there is no exact frozen candidate.
- No production migration, staging apply, live connector run, generation cutover, soak, or rollback was attempted.

## Safe resume order

1. Protect this checkpoint first. Review `git status --short --branch`, the upstream one-commit delta, and user-owned changes. Do not use destructive reset/checkout commands.
2. Audit the interrupted agent changes in `packages/connectors`, `db`, `services`, `verification/testing`, `verification/wp13`, and `verification/wp14`. Treat every existing receipt as stale until its bound source set is recomputed.
3. Resolve the legacy retrieval-schema provenance issue honestly. Preserve the historical `2d778a...` pin; if exact bytes remain unavailable, write an ADR and create a versioned compatibility successor with its own schema and receipt rather than mutating the historical claim.
4. Freeze all workspace descriptors, run `npm install --ignore-scripts --no-audit --no-fund` to regenerate workspace links, and rerun the worker/package-inventory tests.
5. Complete and review WP4. Before binding any local PostgreSQL development service, obey the host rule and run `ss -tlnp`. Run clean-install and N-1 upgrade migrations, role/least-privilege tests, scheduler/harvest integration, workflow replay, retry/DLQ/outbox failure injection, and rollback verification. Fresh `pg.Client` instances must be created per operation/Workflow step from `env.HYPERDRIVE.connectionString` and closed in `finally`.
6. Freeze migrations `0001`–`0003`, then finish WP6 migrations `0004`–`0007`, append-only incremental supersession, referential closure, concurrency, restore, and production-shaped import tests. Only then continue the database-dependent WP7–WP9 migrations/generations.
7. Finish the ingestion-v1.1 DataCite query-key contract: permit bounded, balanced, single-level keys such as `page[number]`, while rejecting empty, unbalanced, nested, control-character, and oversized names. Descriptors may use v1.1 while unchanged harvest/capture/checkpoint envelopes remain truthfully v1.0; validator dispatch must be object/version aware and reject unknown or ambiguous downgrade cases.
8. Run the complete connector wave fixture matrix offline. Keep all live connectors disabled/fixture-only until explicit authorization. Wave 5 may describe application/payment/credential routes but must never automate them.
9. Independently re-audit WP13 and WP14, exercise tamper/canonical-origin/secret-path/rollback/CAS/replay adversarial cases, then reseal only their exact frozen source sets.
10. Complete the external human evidence: WP11 researcher usability study, expert asset/use-card review, identity adjudication, retrieval held-out tuning, planner governance, and coverage wording sign-off.
11. Regenerate all package, WP, CI, program-ledger, and DoD receipts in dependency order. Run the security scan and full test/performance/migration/rollback matrix. Run the repository release gate exactly once only after the exact candidate is frozen.

## External authorization boundary

The external-authorization register currently leaves all entries `not_requested` and `authorized: false`. The blocked actions include paid infrastructure, remote state/secrets, staging migration apply, live connector traffic, managed recovery drills, internal canary, public cutover, production soak, legacy JSONL retirement, remote Git push, production zero-traffic foundation work, planner governance, protected retrieval held-out evaluation, identity human adjudication, and public coverage wording approval. WP11 researcher and expert-review studies also remain external human actions and should be added to or explicitly cross-referenced by that register before final freeze.

## Rollback posture at this checkpoint

Production is unchanged, so no production rollback is required. The local checkpoint is recoverable through careful file-level review of the dirty worktree. Do not use `git reset --hard`, broad checkout, or cleanup commands: they would destroy both program work and unrelated user changes. Before any later cutover, follow `docs/WP14_CUTOVER_RETIREMENT_RUNBOOK.md` and require the repaired WP14 rollback bundle, durable transition ledger, prior-generation pointer, migration rollback/restore receipts, and explicit authorization.

## Definition-of-Done truth statement

The implementation is substantial but the plan's full Definition of Done is not satisfied at this handoff. Specifically, database integration and migration receipts, connector-wave freeze, search-generation integration, protected evaluations, required human studies/authorizations, final security and performance gates, rollback rehearsal, aggregate evidence reseal, and the exact-candidate release gate remain incomplete. Resume from the dependency order above; do not promote provisional local receipts into a completion claim.
