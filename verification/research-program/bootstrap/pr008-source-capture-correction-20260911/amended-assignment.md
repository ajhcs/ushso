# PR-008 — Separate wire fields from labels and scientific meaning

Phase **P1**, sub-phase **1C**. Status: planned.

Dictionary information can coexist with exact API keys without false schema claims.

**Dependencies:** PR-007

**Implementer:** Luna Max, Grok or DeepSeek; assign one owner at dispatch. **Reviewer:** Astra; named human domain/owner decision when required.

**Acceptance requirements:** R02, R05. **Audit findings:** F10, F11, F12.

## Before editing

Read [EXECUTION.md](../EXECUTION.md), the dependency handoffs and the current repository instructions. Start from the merged integration SHA selected in PR-001, not the stale original workspace. Confirm the paths below in that release; create a new path only when it is named here. If an existing package supplies the required behavior, extend it instead of creating a parallel subsystem.

**Owned scope:**

- `packages/identity/src/schema-catalog.mjs`
- `packages/identity/src/variable-identity.mjs`
- `packages/identity/src/index.mjs`
- `packages/identity/manifests/package-manifest.json`
- `packages/identity/validation/validation-receipt.json`
- `contracts/machine-toolkit/v1.2.0/schemas/variable-identity.schema.json`
- `scripts/research/source-extractors.mjs`
- `tests/research-program/variable-identity.test.mjs`
- `tests/research-extractors.test.mjs`
- `tests/dictionary-review.test.mjs`
- `tests/update-cycle.test.mjs`
- `tests/cms-layout.test.mjs`
- `contracts/machine-toolkit/v1.2.0/package.json`
- `contracts/machine-toolkit/v1.2.0/README.md`
- `contracts/machine-toolkit/v1.2.0/tools/verify.mjs`
- `contracts/machine-toolkit/v1.2.0/tests/variable-identity.test.mjs`
- `package-lock.json`

If a shared contract or another owner’s file must change, record the proposed interface change and resolve ownership before editing it. Keep each commit independently understandable and passing the checks appropriate to that change.

## Atomic commits

### C-008-1 — Define variable identity and semantics

Add the strict additive contracts/machine-toolkit/v1.2.0/schemas/variable-identity.schema.json with wire_name, publisher_label, definition, publisher_concept, source_type, observed_type, unit/applicability, code values, missingness and exact source/asset/release/distribution/schema/field-revision context. Preserve frozen v1.0/v1.1 schemas and machine routes. Unresolved context carries nulls and a reason and cannot mint a resolved variable ID. Use context-scoped IDs without weakening existing immutable schema-catalog or join-endpoint contracts; update the current identity package seal through its existing tooling. Complete the existing v1.2.0 variable schema as a private bounded contract package with its own package.json, README, offline strict Ajv2020 validator and meaningful positive/negative tests. Preserve the schema bytes reviewed at a90071e, all v1.0/v1.1 contracts and the existing all-version contract runner. This package grants no route activation, release approval or scientific authority. Use the committed Node/npm versions and existing Ajv 8.20.0 resolution. Root package.json is unchanged; package-lock.json may change only the v1.2 workspace descriptor and its local node_modules link. Do not rewrite earlier package metadata, dependency resolutions, receipt pins or historical evidence.

**Verify:** An identifier field accepts a reasoned not-applicable unit; a measurement missing units remains incomplete. Identical wire names in distinct release/distribution/schema contexts have distinct IDs. Invalid or foreign context cannot become resolved. The current identity package seal and frozen machine compatibility checks pass. Contract discovery recognizes all three machine-toolkit versions and separately executes each test/validate command. The v1.2 schema remains strict and self-contained; literal encodings, mapping ambiguity, concept-versus-definition, unresolved context and unit applicability retain their established meanings. Independently compare the entire lock object before and after, permitting only the two exact workspace/link entries.

### C-008-2 — Preserve literal dictionary extraction

Add a separately versioned extractor/adapter path for CDC/Census/CMS so literal labels, concepts and definitions occupy different fields. Preserve existing cdc_columns/census_variables transformations and their legacy projection byte-for-byte for historical proposal replay. Reuse the existing CMS layout parsers as read-only inputs; dictionary names without a verified wire mapping remain documented names. Record exact evidence pointers, capture/raw-value hashes and transformation versions. No legacy consumer, frozen response or CMS parser rewrite is authorized by this additive scope.

**Verify:** Census concept-only text leaves definition absent in the new model. Literal leading zeros, sentinel strings, Unicode, labels and escaped pointers survive round-trip. Legacy extraction, dictionary review, update-cycle and CMS layout tests remain passing; the old transformations retain their exact outputs.

### C-008-3 — Represent name mappings explicitly

Add evidence-bearing documented-name to wire-name mappings with exact, reviewed alias, ambiguous or unmatched state. Do not normalize away semantic differences automatically. Retain the original missing-package gate failure and append package-completion, lockfile and evidence correction commits without rebasing or relabeling the historical PR008 base/dependency packet. The new lock is a separately reviewed current input for PR086; do not widen WP11 historical approval, alter the current wrapper, or claim combined acceptance from contract-package tests. A precise PR086 current-input amendment and joint exact-candidate gate remain prerequisites to integration acceptance.

**Verify:** The retained sample-shape-comparison.json audit records 117 payload and 117 dictionary fields with 11 identifier discrepancies; keep those supplied literal differences unresolved until additional payload/document context supports each match. The audit is a discrepancy summary, not a full 117-field inventory. Exact, reviewed-alias, ambiguous and unmatched cases retain evidence and alternatives; counts or punctuation normalization alone never approve a mapping.

## PR acceptance

- A 117-field count cannot conceal mismatched field identifiers.
- Variable IDs are scoped by source release/distribution/schema.
- The complete v1.2 variable package executes alongside both earlier machine-toolkit versions. Its additive workspace lock requires separate current-input review, with historical/current approvals kept distinct and the combined gate passing before acceptance.

Use the existing affected package tests plus the specific fixtures described below. Add meaningful regression/integration tests for behavior changes; documentation-only commits use link, schema or artifact checks. Full npm test/build/cf:dry-run run at the integration/release gate.

Run these commands from the isolated repository root after implementing the specified tests. They are planned verification commands, not checks executed by this planning task:

```bash
node --test tests/research-program/variable-identity.test.mjs
node --test tests/research-extractors.test.mjs
node --test tests/dictionary-review.test.mjs
node --test tests/update-cycle.test.mjs
node --test tests/cms-layout.test.mjs
node --test contracts/machine-toolkit/v1.2.0/tests/variable-identity.test.mjs
npm test --prefix packages/identity
npm run validate --prefix packages/identity
npm run validate --prefix contracts/machine-toolkit/v1.2.0
npm run test:contracts
node --test tests/contract-package-inventory.test.mjs
```

The implementation must demonstrate the behavior above using actual fixtures or retained execution evidence. A source capture is not a payload test; a passing schema is not scientific approval; a successful tool envelope is not a completed research task.

## Handoff and independent review

Write the sanitized evidence index under `verification/research-program/pr-008/` and the task-specific handoff under `docs/research-program/handoffs/PR-008.json`. Follow the [handoff template](../templates/handoff.json). Include exact base/head and dependency SHAs; commands with exit statuses; fixtures and expected/actual results; changed public behavior; source/generation identity; artifact hashes; failures; remaining questions; and the next consumer.

Push the task branch to GitHub and open/update a draft PR using the [PR body template](../templates/pr-body.md). Do not mark it ready until producer checks and handoff validation pass. Astra independently inspects the diff and replays the decisive acceptance checks; producer logs alone are not approval. Retain a failing result when blocked and identify the exact missing input. Do not auto-merge or deploy.
