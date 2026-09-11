# PR-003 task and handoff/receipt schemas

Machine-checkable contract material for PR-003 (`C-003-1` plus integrity
corrections `C-003-1-R1` / `C-003-2-R1`, bounded contract corrections
`C-003-2-R2` / `C-003-3-R2`, and remaining-defect corrections
`C-003-2-R3` / `C-003-3-R3`, and the composite-wildcard correction
`C-003-2-R4` / `C-003-3-R4`, and the fixture-context isolation
`C-003-2-R5` / `C-003-3-R5`, and the portable-temp / self-contained
captured-ledger correction `C-003-2-R6` / `C-003-3-R6`). It translates
[`docs/master-plan/2026-09-10/EXECUTION.md`](../../../master-plan/2026-09-10/EXECUTION.md)
and the [PR-003 packet](../../../master-plan/2026-09-10/prs/PR-003.md) into
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
- Completed `observed_exit` records require RFC3339 UTC `started_at` and
  `completed_at` timestamps. The schema permits arbitrary fractional-second
  precision. The checker and schema helper compare the full declared
  fractional instant so `completed_at` may not precede `started_at` within the
  same millisecond; `Date.parse` truncation is not used. Impossible calendar
  dates remain rejected.
- `commands[].event_source`, when present, is an artifact and is checked with
  the same existence, containment and SHA-256 rules as `artifacts[]`.

## Source identity location

Each `source_identities[]` entry must declare `location`:

| `location` | Meaning | Hash rule |
| --- | --- | --- |
| `local` | Repository-relative file (`id` is the path) | `sha256` required; resolved containment (lexical and symlink) and on-disk digest must match |
| `external` | Not a locally hashed current repository file (dispatch prompt outside the worktree, or an immutable Git snapshot) | Plain external digest is descriptive; a `git_commit` + `git_path` + `sha256` triple is verified against `git show` bytes at that commit |

Locality is **not** inferred from `/` or a leading `.` in `id`.

An immutable Git snapshot source supplies `location: "external"`, the exact
40-character `git_commit`, repository-relative `git_path`, and the SHA-256 of
that commit/path's bytes. The checker verifies the commit exists in the
configured `repoRoot`, rejects absolute or traversal paths, proves the path
exists at that commit with `git cat-file -e`, and hashes streamed `git show`
bytes. It does not silently substitute the current working-tree file and does
not use Node's default subprocess buffer. A genuinely missing Git path is
reported as `source_git_path_missing_at_commit`. Execution failures and
explicit size-limit failures are reported separately as
`source_git_snapshot_unreadable` or `source_git_snapshot_size_limit`. This
distinction lets mutable controller documents such as the execution ledger
remain bound to their historical input bytes while current correction
artifacts continue to be checked on disk. Large frozen inputs such as
`evaluation/research-program/cohorts.json` are in scope.

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
   after symlink resolution. The checker `lstat`s each listed path first.
   Only true absence (`ENOENT`) is a typed deletion note
   (`changed_file_not_present`). An existing unresolved symlink is
   `changed_file_symlink_unresolved`: it is not a deletion and is not verified
   containment. A missing changed path is not a pass through an outside
   symlink.
8. **Completed task scope.** A completed packet's `owner`, `branch` and each
   `changed_files[]` entry are compared with the concrete per-PR task binding.
   Ownership uses exact-file paths, trailing-slash directories, and `*` /
   `**` globs. Wildcard tokens are translated separately from regex
   metacharacter escaping: `*` matches one slash-free segment and `**`
   matches zero or more segments, including an interior globstar with no
   intervening directory (`tests/**/*.mjs` matches `tests/one.mjs`). Composite
   wildcard prefixes remain wildcard-aware when followed by a suffix `/**`
   or trailing slash (`tests/*/**`, `docs/**/fixtures/**`, and `tests/*/`).
   Suffix `dir/**`, trailing-slash `dir/`, exact-file and sibling-boundary
   rejection are unchanged. A producer-written task-binding file does not
   authenticate itself and does not replace the controller's immutable
   dispatch review.
9. **Malformed packet versus tool failure.** A syntactically valid JSON value
   that is schema-invalid, including `null` or noniterable collection types
   and `null` or non-object items inside `commands`, `artifacts`,
   `source_identities`, `acceptance_results`, `failures_and_skipped_checks`
   or `unresolved_claims`, returns the normal rejected packet report
   (`outcome=rejected`, CLI exit 1) with `schema_invalid` findings. It does
   not throw and is not an operational tool failure (CLI exit 2). File and
   Git operational failures remain typed and are not reported as packet
   success. Structurally safe incomplete packets still receive the named
   semantic rejection rules used by the regression suite.

## Per-PR binding (no shared sibling)

A single `docs/research-program/handoffs/task-binding.json` is **not** used: it
would bind every later PR to PR-003. The C-003-1 task schema and the PR-003
dispatch/task-binding evidence live under
`verification/research-program/pr-003/`. Other PRs add their own
`verification/research-program/pr-NNN/` binding when they exist.

Lookup is exclusive first-match so historical fixture bindings stay scoped to
their own fixtures:

1. a sibling `task-binding.json` next to the handoff (used by the committed
   fixtures);
2. otherwise `verification/research-program/pr-NNN/task-binding.json`;
3. otherwise that directory's `fixtures/task-binding.json`.

A later per-PR correction binding is not required to agree with a fixture
sibling from an earlier recovery. Ledger dependency SHAs are still compared
when present. The resolved binding path and SHA-256 identify which concrete
file established the packet's task binding; that file is not a signature.

## Validator roots and schema authority

`checkHandoff(handoffPath, { repoRoot, contextRoot })` treats `repoRoot` as the
repository root for the handoff input, task-binding lookup, artifact/event-source
files, local source identities, and `changed_files[]` containment. Relative
input paths are resolved against that root; absolute inputs are accepted only
when they resolve inside it. Sibling and per-PR task-binding files are
realpath-checked before their JSON is read.

By default, with no `contextRoot` / `--context`, the execution ledger is read
only from that same `repoRoot` and Git commands use `repoRoot` as cwd. That
default remains the strict production path: a completed packet whose task
binding disagrees with the live ledger still fails `binding_conflict`.

An explicit `contextRoot` (CLI `--context <dir>`) must resolve inside
`repoRoot`. It supplies only `docs/research-program/execution-ledger.json` and
the Git cwd. Packet, artifact, source, changed-file and task-binding paths stay
bound to `repoRoot`. Git commands issued from a nested in-repo context still
resolve the containing repository; no copied `node_modules`, Git-metadata
workaround or extra checkout is required. A small ignored fixture root can
therefore carry a controlled ledger that cannot inherit the controller's
changing PR task base, while production current-handoff checks omit `--context`
and keep live-ledger validation.

Historical fixture checks that need a temporary directory honor a valid
absolute `TMPDIR`, then a valid absolute `RUNNER_TEMP` when `TMPDIR` is
absent, then an ignored in-repository fixture scratch root. Literal `/tmp`
and `/home` are not used as bulk scratch. Task-owned children are created
with `mkdtemp` and removed individually; an existing unrelated directory is
never recursively removed. The observed `f62ce354` vs `0b28d036`
`binding_conflict` is reproduced from a committed PR-003 task-row extraction
of captured ledger `0c29fdb984c7bb4c101650e4bae86c716048c237` (`git_path`
`docs/research-program/execution-ledger.json`, source SHA-256
`58a28c0767657d66a9bf35991d1f5e241d6e14f60ff8cd17408ad7c8880e8702`). That
commit is captured diagnostic data, not an ancestor of this PR-003 branch;
routine tests do not `git show` it.

The JSON Schemas remain pinned to the validator module's authoritative
`docs/research-program/handoffs/schema/` directory. `repoRoot` does not select
an arbitrary replacement schema directory. A caller using another repository
root therefore gets the same contract definitions while all packet, evidence,
task, ledger and Git paths are resolved within the supplied root; the caller
must provide the expected per-PR binding and ledger there. Historical fixture
packets additionally provide a controlled ledger through `contextRoot` instead
of being rewritten onto the latest live base.

A precommit producer packet may use `head_sha: null` only with a typed pending
or unresolved head claim. That transport state is accepted for
`producer_checked`/`draft_pr` evidence and means a controller will bind the
actual commit in an external receipt after committing. It cannot advertise
`independently_verified`, `merged`, `integrated` or `qualified` with a null
head, and an untyped null is never treated as a commit.

## Downstream handoff migration

Active PR-004 and PR-085 packets should use this contract at their boundary:
record RFC3339 UTC `started_at`/`completed_at` values with end at or after
start, structured `expected_outcome` and `observed_outcome`, and a typed
pending head until a controller binds the committed SHA/tree. Hash current
local artifacts on disk and bind historical inputs with an exact Git
commit/path/hash triple; do not repin a mutable current file as historical
bytes. Completed statuses carry the required status-specific evidence.
PR-001 and PR-002 remain byte-identical legacy packets under the explicit
migration boundary below.

## Disposition of existing packets (format migration boundary)

`PR-001.json` and `PR-002.json` were produced before this contract existed and
are retained **byte-identical** as historical records. They are not
retroactively rewritten, and this schema intentionally does not claim to
validate them (they carry extra fields and a different evidence shape). Handoffs
produced from PR-003 onward are expected to satisfy the contract, including the
R1 integrity corrections, the R2 contract corrections, the R3
null-item/wildcard-ownership corrections, the R4 composite-wildcard
correction, the R5 fixture-context isolation and the R6 portable-temp /
self-contained captured-ledger correction. A handoff is a
producer artifact: passing this schema is not independent verification and not
scientific approval.

Historical C-003-1 / C-003-2 / C-003-3, R1 and R2 command receipts and evidence
indexes under `verification/research-program/pr-003/` are preserved
byte-for-byte. They record runs against earlier validators and remain
explicitly historical; they are not re-presented as fresh checks. R3, R4, R5
and R6 correction evidence each have separate additive indexes that bind their
current files and cite historical bytes through immutable Git commit/path/hash
triples.

## Reproduce

```bash
node verification/research-program/pr-003/verify-schema-contract.mjs
node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-003.json
node scripts/research-program/check-handoff.mjs --context verification/research-program/pr-003/fixtures/.context/matching verification/research-program/pr-003/fixtures/handoff.valid.json
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
- Final-contract correction base (R2): `bf46d92b0e4fc91457bd3eb78aa1742ae84038f2`
  (tree `98e04d100daa94cdf9da5905c15d58a0aae6778d`). The independently reviewed
  code was `dc7267bf1c872f1457fa927e2d0403051575f474`; `bf46d92` adds only the
  independently accepted test-chain inventory correction.
- Remaining-defect correction base (R3): `5115170093512b06b21c01725bb982e457797efe`
  (tree `24fe636b0370e2e7b9c166d6f1c6bed520ed033e`).
- Composite-wildcard correction base (R4): `0b28d036f1df4b5248732bc62f68edd79f14d06f`
  (tree `6e2de2232e2aa0f19055751d70e5a904a38216f9`), the exact reviewed R3
  candidate.
- Fixture-context isolation base (R5): `d1c42eab33e1c21edf805036464f2b64667a489a`
  (tree `d765aa66a6bc360a3c03a86eaf54b6366ccb2be1`), the exact reviewed R4
  candidate.
- Portable-temp / self-contained captured-ledger base (R6):
  `243a12510eb8ed3c7646d8a4d5d151a46b3cf28a`
  (tree `e55c6413693acb39661c1457fcfee109603b6cc9`), the exact reviewed R5
  candidate. Functional R5 remains `852c0cfe8eb81bbca34306ab5fd192ab1558a07f`
  (tree `686b8c57095410cd054823dff64342f90ca24de8`).
- Accepted PR-002 merge (dependency): `5647e81457b606bb36456e75c48f990ce21e9c6c`.
- PR-001 merge (dependency): `035465f3f16d15f02467679d96451d4440a36ca8`.
- Dispatch prompt SHA-256: `f3ae24ec04a5b8c92920fa1210399bd214ad9aa3bb4ad4773e930302fb10d07d`.
- Independent final-contract review receipt SHA-256:
  `99b542280dc18a34c22affb1dcc6a87780db58be7b53c1e30c9cf37dc33470e6`.
- Independent R2 review receipt SHA-256:
  `91924040dd21957d55eab626d19abbfb86b9243b56b6c4caa12635314aae4681`.
- R4 composite-wildcard correction prompt SHA-256:
  `b1a0895101086a2843c96a4089763717091e16b4c073ab2cd9045dea8d259edc`.

Authorship is layered and must not be collapsed:

- Initial PR-003 implementation (`C-003-1` / `C-003-2` / `C-003-3`) was native
  DeepSeek.
- The earlier Grok partial `ushso-pr003-grok-corrections-20260910` failed with
  no commit. Its snapshot, terminal receipt and retained patch remain
  historical evidence, not completed Grok work.
- Luna completed the R1 recovery (`C-003-1-R1` / `C-003-2-R1`). Historical R1
  receipts and the R1 evidence index retain Luna's producer self-label
  `gpt-5.6-luna-max/high`. Root's native dispatch specified `gpt-5.6-luna/max`;
  the producer self-label is not a serving-model attestation. Those R1 records
  are Luna's work, not completed Grok work.
- The separately scoped R2 correction is Grok Co-Engineer work
  (`execution.provider: grok`, `execution.model: grok-4`) on the reviewed
  composed candidate. It is not a replay of the failed 2026-09-10 Grok task.
- This separately scoped R3 correction is Grok Co-Engineer work
  (`execution.provider: grok`, `execution.model: grok-4`) on the independently
  reviewed R2 result. It is not a replay of R1 or of the failed 2026-09-10
  Grok task.
- This separately scoped R4 correction is a controller-requested native Luna
  continuation (`gpt-5.6-luna`, reasoning `max`) on the reviewed Grok R3
  result. The serving backend identity is not independently inspectable through
  this interface; the R3 Grok implementation remains historical evidence and
  is not credited with the R4 patch.
- This separately scoped R5 correction is Grok Co-Engineer work
  (`execution.provider: grok`, `execution.model: grok-4`; this interface
  identifies as Grok 4.6) on the reviewed R4 result. It isolates historical
  fixture packets from the moving live execution ledger without weakening
  default production conflict checks. It is not a replay of R1–R4 or of the
  failed 2026-09-10 Grok task.
- This separately scoped R6 correction is Grok Co-Engineer work
  (`execution.provider: grok`, `execution.model: grok-4`; this interface
  identifies as Grok 4.6) on the reviewed R5 result. It makes fixture
  temporary storage portable and replaces runtime `git show` of non-ancestor
  `0c29fdb` with a committed task-row extraction. It is not a replay of
  R1–R5 or of the failed 2026-09-10 Grok task.

Reviewer Astra. `head_sha` stays null until the controller records the actual
final commit; a future commit cannot contain its own hash. Root owns
independent review, publication, merge and deployment. Full integrated
`npm test` / build / Cloudflare hosted CI currently needs a separate PR-085
CI inventory correction and is not claimed here.
