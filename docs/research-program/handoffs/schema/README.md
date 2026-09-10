# PR-003 task and handoff/receipt schemas

Machine-checkable contract material for PR-003 (`C-003-1` plus integrity
corrections `C-003-1-R1` / `C-003-2-R1`). It translates
[`docs/master-plan/2026-09-10/EXECUTION.md`](../../../../master-plan/2026-09-10/EXECUTION.md)
and the [PR-003 packet](../../../../master-plan/2026-09-10/prs/PR-003.md) into
two JSON Schema documents that preserve the evidence an independent reviewer
needs without reading a chat transcript.

## Files

| File | Contract |
| --- | --- |
| `task.schema.json` | One bounded implementer task/dispatch: owner, branch/worktree, objective, dependencies, owned paths, atomic commits, exact check commands, evidence directory, review states, and the concrete `binding` (integration base SHA, accepted dependency merge SHAs, dispatch prompt/bootstrap hashes). |
| `handoff.schema.json` | One implementer handoff/receipt: exact base/head/dependency SHAs, changed files, problem and resulting behavior, commits, source identities, commands with typed expected/observed outcomes, artifacts with hashes, acceptance results, failures/skips, unresolved claims, risks, next consumer/action, and independent-review state. |

Both use JSON Schema draft 2020-12 and are compiled with Ajv in `strict` mode,
the same validator family already used by
`@ushso/observatory-retrieval` (`packages/retrieval/tools/schema-validation.mjs`).

## Preserved fields (EXECUTION.md "Communication and retained notes")

The handoff contract keeps, as required fields, every item EXECUTION.md lists:

- exact base, head and dependency SHAs (`base_sha`, `head_sha`, `dependency_merge_shas`);
- changed files (`changed_files`) and behavior (`problem`, `resulting_behavior`);
- contract/source/corpus/schema/model version identity (`source_identities`);
- commands, timestamps, exit codes and expected-versus-actual observations (`commands[].command`, `started_at`, `completed_at`, `exit_code`, `completion_status`, `expected`, `actual`, plus structured `expected_outcome` / `observed_outcome`);
- sanitized artifact paths and hashes, with an optional durable link (`artifacts[]`);
- fixture/acceptance observations (`acceptance_results[]`);
- known failures, skipped checks and unresolved claims (`failures_and_skipped_checks`, `unresolved_claims`, `risks`);
- the next consumer/action (`next_consumer`, `next_action`);
- the independent-review state (`independent_review`).

Typed non-pass outcomes are preserved rather than coerced: an acceptance
result may be `blocked`, `unavailable`, `unresolved` or `failed`; a command may
record an explicit typed `observed_outcome` instead of an invented `exit_code`;
and no success state can be claimed without an observed command outcome that
matches its explicit expected outcome.

## Structured command outcomes

Narrative `expected` / `actual` strings are optional commentary. They are **not**
parsed. The contract is:

- `expected_outcome` and `observed_outcome` are objects with `kind`
  (`observed_exit`, `unavailable`, `blocked`, `failed`, `unresolved`).
- `kind=observed_exit` requires a numeric `exit_code`. Nonzero is legitimate
  when the check is an **expected-negative** (the command was designed to exit
  nonzero and did so). Do not require `exit_code=0` for every success claim.
- A success acceptance state (`passed`, `producer_checked`,
  `independently_verified`) requires every referenced command to have an
  observed outcome (or explicit typed unavailability) **and** an explicit
  expected outcome, and the two must match.
- Missing `exit_code` / `completion_status` / `actual` with no structured
  observed outcome is not a captured execution result.
- Completed `observed_exit` records require non-null `started_at` and
  `completed_at`.
- `commands[].event_source`, when present, is an artifact and is checked with
  the same existence, containment and SHA-256 rules as `artifacts[]`.

## Source identity location

Each `source_identities[]` entry must declare `location`:

| `location` | Meaning | Hash rule |
| --- | --- | --- |
| `local` | Repository-relative file (`id` is the path) | `sha256` required; resolved containment (lexical and symlink) and on-disk digest must match |
| `external` | Not a locally hashed repository file (dispatch prompt outside the worktree, git object identity, etc.) | Digest may be recorded; it is not proof of on-disk bytes |

Locality is **not** inferred from `/` or a leading `.` in `id`.

## Status-specific evidence

`status` is the EXECUTION.md review-state enum. Completed producer states
(`producer_checked`, `draft_pr`, `independently_verified`, `merged`,
`integrated`, `qualified`) require a non-null `owner` and non-empty
`changed_files`, `source_identities`, `commands`, `artifacts` and
`acceptance_results`. `planned` / `ready` / `in_progress` / `blocked` /
`changes_requested` / `independent_review` may be incomplete. Packet validity
is not scientific or independent acceptance.

## Enforced rejection rules

JSON Schema alone cannot compare values across documents, resolve Git objects,
or prove uniqueness of `id` fields that differ in other properties. The schema
enforces the structural half, and the bounded checkers enforce the rest.

1. **Claimed pass without a command result.** `acceptance_results[].status`
   in `passed`/`producer_checked`/`independently_verified` requires a non-empty
   `command_ids` (JSON Schema `if/then`), and every referenced command must
   resolve to a `commands[]` entry with a captured observed outcome (checker
   rule `claimed_pass_without_command_result`).
2. **Expected/observed mismatch.** A success claim whose command
   `expected_outcome` does not match `observed_outcome` (including expected
   exit 0 vs observed exit 1) is rejected (`command_outcome_mismatch`). An
   expected-negative whose expected and observed exits are the same nonzero
   value is accepted.
3. **Missing artifact.** Every `acceptance_results[].artifact_ids` value must
   resolve to an `artifacts[]` entry (checker rule `missing_artifact`). Nested
   `commands[].event_source` records are verified as artifacts
   (`artifact_missing_on_disk`, `artifact_hash_mismatch`, containment rules).
4. **Stale or unbound base/dependency SHA.** Every `dependency_merge_shas`
   entry must match the resolved task binding and the execution ledger.
   `base_sha` must match a concrete binding `base_sha`. Lookup order: sibling
   `task-binding.json`, then
   `verification/research-program/pr-NNN/task-binding.json`, then
   `verification/research-program/pr-NNN/fixtures/task-binding.json`. A
   completed packet with no concrete base binding is rejected
   (`base_sha_unbound`); it is not accepted as complete. Ledger dependency
   SHAs are still compared when present.
5. **Git object binding.** `base_sha` must be a local commit. Non-null
   `head_sha` must be a local commit whose base is an ancestor (or the same
   commit). `head_sha: null` remains the documented pending-head transport
   state before a commit exists and is **not** treated as a synthetic all-zero
   SHA. Well-formed but nonexistent heads (including all-zero) are rejected.
6. **Ambiguous IDs.** Duplicate `commands[].id` or artifact ids (top-level or
   nested event-source) are rejected before Map construction
   (`duplicate_command_id`, `duplicate_artifact_id`).
7. **Changed-file and local-reference containment.** Declared local paths,
   including existing `changed_files[]` entries, are checked lexically and
   after symlink resolution. A missing changed path is a typed deletion note,
   not a pass through an outside symlink.

## Per-PR binding (no shared sibling)

A single `docs/research-program/handoffs/task-binding.json` is **not** used: it
would bind every later PR to PR-003. The C-003-1 task schema and the PR-003
dispatch/task-binding evidence live under
`verification/research-program/pr-003/`. Other PRs add their own
`verification/research-program/pr-NNN/` binding when they exist.

## Validator roots and schema authority

`checkHandoff(handoffPath, { repoRoot })` treats `repoRoot` as the repository
root for the handoff input, task-binding and execution-ledger lookup, Git
commands, artifact/event-source files, local source identities, and
`changed_files[]` containment. Relative input paths are resolved against that
root; absolute inputs are accepted only when they resolve inside it. Sibling
and per-PR task-binding files are realpath-checked before their JSON is read,
and the execution ledger is read only from that same root. This prevents a
fixture or copied repository from silently using a sibling repository's ledger
or binding.

The JSON Schemas remain pinned to the validator module's authoritative
`docs/research-program/handoffs/schema/` directory. `repoRoot` does not select
an arbitrary replacement schema directory. A caller using another repository
root therefore gets the same contract definitions while all packet, evidence,
task, ledger and Git paths are resolved within the supplied root; the caller
must provide the expected per-PR binding and ledger there.

A precommit producer packet may use `head_sha: null` only with a typed pending
or unresolved head claim. That transport state is accepted for
`producer_checked`/`draft_pr` evidence and means a controller will bind the
actual commit in an external receipt after committing. It cannot advertise
`independently_verified`, `merged`, `integrated` or `qualified` with a null
head, and an untyped null is never treated as a commit.

## Disposition of existing packets (format migration boundary)

`PR-001.json` and `PR-002.json` were produced before this contract existed and
are retained **byte-identical** as historical records. They are not
retroactively rewritten, and this schema intentionally does not claim to
validate them (they carry extra fields and a different evidence shape). Handoffs
produced from PR-003 onward are expected to satisfy the contract, including the
R1 integrity corrections. A handoff is a producer artifact: passing this schema
is not independent verification and not scientific approval.

Historical C-003-1 / C-003-2 / C-003-3 command receipts and evidence indexes
under `verification/research-program/pr-003/` are also preserved byte-for-byte.
They record runs against the uncorrected validator. Correction evidence is a
separate index that binds current files and cites those historical bytes through
immutable Git `f62ce35481cc572e9aad054049c700aac6378f58`.

## Reproduce

```bash
node verification/research-program/pr-003/verify-schema-contract.mjs
node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-003.json
```

The C-003-1 checker reads the two schemas, validates the fixtures under
`verification/research-program/pr-003/fixtures/`, applies the cross-reference
rules above, prints a JSON summary, and exits non-zero if any fixture does not
behave as declared. The C-003-2 validator adds path containment, on-disk
hashing, Git object binding and per-PR base lookup.

## Provenance

- Original PR-003 integration base: `e5c44249b9d2448df2e4b6d466077658e42a009d`.
- Integrity-correction base (R1): `f62ce35481cc572e9aad054049c700aac6378f58`
  (tree `548d34311909ab3c4bb36c126896c7787d9b3dab`).
- Accepted PR-002 merge (dependency): `5647e81457b606bb36456e75c48f990ce21e9c6c`.
- PR-001 merge (dependency): `035465f3f16d15f02467679d96451d4440a36ca8`.
- Dispatch prompt SHA-256: `f3ae24ec04a5b8c92920fa1210399bd214ad9aa3bb4ad4773e930302fb10d07d`.
- Authored under slices `C-003-1` (DeepSeek) and `C-003-1-R1`/`C-003-2-R1`
  (Grok integrity corrections). Reviewer Astra. `head_sha` stays null until the
  controller records the actual final commit; a future commit cannot contain
  its own hash.
