Implement the complete bounded PR-007 assignment below using Grok. The controller remains independent reviewer, publisher and merge authority.

Exact clean integration base: 15b351a92af729f9ba07359fd210123fdfd76bb3, tree c46c95ad838b78d4a26c86454be82f3835c49e51. PR003/PR004/PR085 were accepted and integrated through GitHub PR18, merge 548edf64c20f474d6832996ce5ac29e0ff25be0b. This base adds only the accepted evidence and ready-task ledger. Your sole direct dependency is PR-004 at actual component merge 463f092f71c0ed1ef2aa5baa29b186e5697d04ce; its accepted producer head is 78d164e816049c45193b17c2267f64c8fb783399. Do not add unrelated direct dependencies or relabel the producer head as the dependency merge.

Read AGENTS.md, README.md, docs/ARCHITECTURE.md, docs/EVALUATION.md, the exact packet docs/master-plan/2026-09-10/prs/PR-007.md, and docs/master-plan/2026-09-10/EXECUTION.md. Consume verification/research-program/bootstrap/components-463f092/pr-004-integration-handoff.json and its artifact manifest. The final PR003 handoff schemas/checker are already integrated; read docs/research-program/handoffs/schema/README.md and validate your project handoff with node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-007.json.

Owned paths only:
- packages/identity/src/
- packages/identity/schemas/
- packages/registry/
- tests/research-program/release-binding.test.mjs
- docs/research-program/handoffs/PR-007.json
- verification/research-program/pr-007/

A parallel assignment owns different packages. Do not modify the global execution ledger, root package.json, lockfile, production configuration, historical approvals/evidence, frozen cohorts, shared handoff schemas/checker or another PR's paths. If a contract change outside your scope is necessary, report a concrete proposed delta and continue independent owned work.

Use the managed worktree supplied by Co-Engineer and its already-held writer lifecycle. Never reconstruct its token, copy node_modules, create desktop tasks or use the dirty original workspace. Follow host storage/TMPDIR rules. Use Node >=22.15 and the committed npm lockfile; pinned npm11.19.1 is available at /mnt/d/tmp/plumbob/ushso-research-program-20260910/tooling/node_modules/.bin/npm. Do not run a separate full release build/gate; execute all affected package checks required by the packet. Check listeners before any local server and stop task-owned servers afterward.

For the application-level handoff contract, create verification/research-program/pr-007/task-binding.json from the task schema, using owner Grok, reviewer Astra, your actual managed branch/worktree, base_sha 15b351a92af729f9ba07359fd210123fdfd76bb3, base_tree c46c95ad838b78d4a26c86454be82f3835c49e51, and dependency_merge_shas {"PR-004":"463f092f71c0ed1ef2aa5baa29b186e5697d04ce"}. This is the project's PR evidence binding, separate from the machine-generated Co-Engineer lifecycle receipt. No invented dispatch/bootstrap hashes are required. Record actual provider/model from the interface; do not promote a producer self-label to a serving-model attestation. Use producer_checked status and a typed pending head if needed to avoid embedding a future commit's own hash; the controller binds your final actual head.

Complete all three planned atomic commits with meaningful positive and negative checks and actual command receipts. Keep each committed state reviewable; preserve genuine before-change failures as evidence without committing knowingly failing tests. Add a small reproducible verification script when necessary for decisive CLI/API observations. Evidence must include exact timestamps/exit codes, hashes, original source/generation identities, expected and observed outcomes, failed/skipped checks and downstream instructions. Preserve prior evidence rather than rewriting it after failures. Commit all owned final work and return a clean tree with a concise final report and exact commits. Do not push, open PRs, merge or deploy; the controller handles reviewed publication.

Scientific constraints: generation live-2026-09-03-85b50522b420; manifest85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e. Preserve all3434baseline records,3430searchable and4isolated; PR002cohorts/tasks/acceptance bytes are frozen. Catalog membership, HTTP200, inferred search tags, captured documentation, successful synthetic fixtures and model agreement do not establish payload access or scientific fitness. Preserve exact publisher field names, typed unknown/conflict/restricted/failed states, source/release identities and disabled-feature boundaries. Use captured public/no-PHI fixtures; no live collection, paid product enrichment, private evaluator labels or external credentials are needed.

Decisive review focus: preserve established stable IDs and distinguish source-native release/revision identifiers, rolling resources, replacement content, one-to-many distributions and conflicting date roles. A reachable or repeated URL alone cannot supply an exact release binding. Resolved IDs require source evidence or a documented deterministic content/context identity rule. Build an explicit human-manifest/machine-generation/dictionary-source-revision map; mismatched or stale inputs must produce typed restart guidance. Reuse existing identity/registry contracts; do not build a parallel subsystem or promote unresolved dictionary/schema applicability into approval.

Exact assignment packet follows:

# PR-007 — Bind products to releases and distributions

Phase **P1**, sub-phase **1C**. Status: planned.

Source-native identities can supply actual context IDs to clients.

**Dependencies:** PR-004

**Implementer:** Luna Max, Grok or DeepSeek; assign one owner at dispatch. **Reviewer:** Astra; named human domain/owner decision when required.

**Acceptance requirements:** R02, R04, R05, R11. **Audit findings:** F11, F18, F19, F21.

## Before editing

Read [EXECUTION.md](../EXECUTION.md), the dependency handoffs and the current repository instructions. Start from the merged integration SHA selected in PR-001, not the stale original workspace. Confirm the paths below in that release; create a new path only when it is named here. If an existing package supplies the required behavior, extend it instead of creating a parallel subsystem.

**Owned scope:**

- `packages/identity/src/`
- `packages/identity/schemas/`
- `packages/registry/`
- `tests/research-program/release-binding.test.mjs`

If a shared contract or another owner’s file must change, record the proposed interface change and resolve ownership before editing it. Keep each commit independently understandable and passing the checks appropriate to that change.

## Atomic commits

### C-007-1 — Define release and distribution identity rules

Reuse the existing source/release/distribution contracts; add publisher identifiers, locator, release/revision date roles and hash-scoped identity when a publisher supplies no stable release ID.

**Verify:** Fixtures cover rolling endpoints, a replacement file, multiple distributions and conflicting dates without merging them.

### C-007-2 — Resolve exact source relationships

Implement deterministic binding from captured catalog/resources records to releases and distributions. Preserve ambiguous and unresolved alternatives with evidence pointers.

**Verify:** One-to-many publisher distributions remain distinct; an ambiguous URL never produces a fabricated exact binding.

### C-007-3 — Add generation identity mapping

Publish one explicit map between human manifest identity, machine generation and dictionary/source revision. Reject inconsistent cross-generation references.

**Verify:** Human-to-machine source lookup returns the same product context; stale or mismatched pins yield typed restart guidance.

## PR acceptance

- Every resolved ID has source evidence or a documented deterministic identity rule.
- No existing stable ID changes meaning.

Use the existing affected package tests plus the specific fixtures described below. Add meaningful regression/integration tests for behavior changes; documentation-only commits use link, schema or artifact checks. Full npm test/build/cf:dry-run run at the integration/release gate.

Run these commands from the isolated repository root after implementing the specified tests. They are planned verification commands, not checks executed by this planning task:

```bash
node --test tests/research-program/release-binding.test.mjs
```

The implementation must demonstrate the behavior above using actual fixtures or retained execution evidence. A source capture is not a payload test; a passing schema is not scientific approval; a successful tool envelope is not a completed research task.

## Handoff and independent review

Write the sanitized evidence index under `verification/research-program/pr-007/` and the task-specific handoff under `docs/research-program/handoffs/PR-007.json`. Follow the [handoff template](../templates/handoff.json). Include exact base/head and dependency SHAs; commands with exit statuses; fixtures and expected/actual results; changed public behavior; source/generation identity; artifact hashes; failures; remaining questions; and the next consumer.

Push the task branch to GitHub and open/update a draft PR using the [PR body template](../templates/pr-body.md). Do not mark it ready until producer checks and handoff validation pass. Astra independently inspects the diff and replays the decisive acceptance checks; producer logs alone are not approval. Retain a failing result when blocked and identify the exact missing input. Do not auto-merge or deploy.
