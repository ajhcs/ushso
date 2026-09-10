# PR-003 task and handoff/receipt schemas

Machine-checkable contract material for PR-003 (`C-003-1 — Add the task and
receipt schemas`). It translates
[`docs/master-plan/2026-09-10/EXECUTION.md`](../../../../master-plan/2026-09-10/EXECUTION.md)
and the [PR-003 packet](../../../../master-plan/2026-09-10/prs/PR-003.md) into
two JSON Schema documents that preserve the evidence an independent reviewer
needs without reading a chat transcript.

## Files

| File | Contract |
| --- | --- |
| `task.schema.json` | One bounded implementer task/dispatch: owner, branch/worktree, objective, dependencies, owned paths, atomic commits, exact check commands, evidence directory, review states, and the concrete `binding` (integration base SHA, accepted dependency merge SHAs, dispatch prompt/bootstrap hashes). |
| `handoff.schema.json` | One implementer handoff/receipt: exact base/head/dependency SHAs, changed files, problem and resulting behavior, commits, source identities, commands with typed results, artifacts with hashes, acceptance results, failures/skips, unresolved claims, risks, next consumer/action, and independent-review state. |

Both use JSON Schema draft 2020-12 and are compiled with Ajv in `strict` mode,
the same validator family already used by
`@ushso/observatory-retrieval` (`packages/retrieval/tools/schema-validation.mjs`).

## Preserved fields (EXECUTION.md "Communication and retained notes")

The handoff contract keeps, as required fields, every item EXECUTION.md lists:

- exact base, head and dependency SHAs (`base_sha`, `head_sha`, `dependency_merge_shas`);
- changed files (`changed_files`) and behavior (`problem`, `resulting_behavior`);
- contract/source/corpus/schema/model version identity (`source_identities`);
- commands, timestamps, exit codes and expected-versus-actual observations (`commands[].command`, `started_at`, `completed_at`, `exit_code`, `completion_status`, `expected`, `actual`);
- sanitized artifact paths and hashes, with an optional durable link (`artifacts[]`);
- fixture/acceptance observations (`acceptance_results[]`);
- known failures, skipped checks and unresolved claims (`failures_and_skipped_checks`, `unresolved_claims`, `risks`);
- the next consumer/action (`next_consumer`, `next_action`);
- the independent-review state (`independent_review`).

Typed non-pass outcomes are preserved rather than coerced: an acceptance
result may be `blocked`, `unavailable`, `unresolved` or `failed`; a command may
record a provider's non-numeric completion status instead of an invented
`exit_code`; and no success state can be claimed without a command result.

## Enforced rejection rules

JSON Schema alone cannot compare values across documents or resolve
references. The schema enforces the structural half, and the bounded C-003-1
checker (and, later, the C-003-2 validator) enforces the cross-reference half.

1. **Claimed pass without a command result.** `acceptance_results[].status`
   in `passed`/`producer_checked`/`independently_verified` requires a non-empty
   `command_ids` (JSON Schema `if/then`), and every referenced command must
   resolve to a `commands[]` entry with a non-empty `result` (checker rule
   `claimed_pass_without_command_result`).
2. **Missing artifact.** Every `acceptance_results[].artifact_ids` value must
   resolve to an `artifacts[]` entry (checker rule `missing_artifact`).
3. **Stale dependency SHA.** Every `dependency_merge_shas` entry must match the
   task `binding.dependency_merge_shas` for the same PR key, and `base_sha`
   must match the task base (checker rules `stale_dependency_sha`,
   `stale_base_sha`, `unexpected_dependency`, `missing_dependency_sha`).

## Disposition of existing packets

`PR-001.json` and `PR-002.json` were produced before this contract existed and
are retained as historical records. They are not retroactively rewritten, and
this schema intentionally does not claim to validate them. Handoffs produced
from PR-003 onward are expected to satisfy it. A handoff is a producer
artifact: passing this schema is not independent verification and not
scientific approval.

## Reproduce

```bash
node verification/research-program/pr-003/verify-schema-contract.mjs
```

The checker reads the two schemas, validates the fixtures under
`verification/research-program/pr-003/fixtures/`, applies the cross-reference
rules above, prints a JSON summary, and exits non-zero if any fixture does not
behave as declared.

## Provenance

- Base integration SHA: `e5c44249b9d2448df2e4b6d466077658e42a009d`.
- Accepted PR-002 merge (dependency): `5647e81457b606bb36456e75c48f990ce21e9c6c`.
- PR-001 merge (dependency): `035465f3f16d15f02467679d96451d4440a36ca8`.
- Dispatch prompt SHA-256: `f3ae24ec04a5b8c92920fa1210399bd214ad9aa3bb4ad4773e930302fb10d07d`.
- Authored under slice `C-003-1`; owner DeepSeek (`deepseek/deepseek-v4.1-flash`,
  reasoning `high`), reviewer Astra. No commit is created by the slice; the
  controller commits after inspecting the allowlisted diff.
