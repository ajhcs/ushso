# PR-003 C-003-1 — task and receipt schemas (evidence)

Sanitized evidence for slice `C-003-1 — Add the task and receipt schemas` of
[PR-003](../../../docs/master-plan/2026-09-10/prs/PR-003.md). This directory is
the PR-003 evidence directory; later slices C-003-2 and C-003-3 may add to it.

## Deliverables

| Path | Purpose |
| --- | --- |
| `docs/research-program/handoffs/schema/task.schema.json` | Task/dispatch contract (owner, branch, owned paths, commits, checks, binding). |
| `docs/research-program/handoffs/schema/handoff.schema.json` | Handoff/receipt contract (base/head/dependency SHAs, commands/exits, artifacts/hashes, risks, next consumer). |
| `docs/research-program/handoffs/schema/README.md` | Field and provenance documentation, including the three rejection rules. |
| `verify-schema-contract.mjs` | Bounded local check: Ajv 2020-12 structural validation plus cross-reference rules. |
| `fixtures/task-binding.json` | The C-003-1 task/binding packet bound to the concrete base and dependency SHAs. |
| `fixtures/handoff.valid.json` | Valid packet, artifact hashes bound to real local files. |
| `fixtures/handoff.reject-*.json` | The three required rejection cases. |
| `command-receipts/*.json` | Sanitized receipts with actual start/end, exit codes and expected-versus-actual observations. |
| `dispatch-binding.json` | Verified launch values, dependency artifacts and the dispatch prompt binding. |
| `evidence-index.json` | Hash index for the artifacts above. |

## Reproduce the decisive check

```bash
node verification/research-program/pr-003/verify-schema-contract.mjs
```

Expected: exit `0` with `ok: true`; `handoff.valid.json` accepted and each
`handoff.reject-*.json` rejected for its declared rule.

## Receipts

| Command | Exit | Result |
| --- | --- | --- |
| `node verification/research-program/pr-003/verify-schema-contract.mjs` | 0 | `ok=true`; 1 valid accepted, 3 rejection fixtures rejected for their declared reasons. |
| on-disk artifact SHA-256 recomputation | 0 | 5 artifacts checked, 0 mismatches. |
| `git merge-base --is-ancestor 5647e814… HEAD` + `git rev-parse HEAD` | 0 | PR-002 merge is an ancestor; HEAD equals the eligible base `e5c4424…`. |

## Sanitization

No private raw logs, credentials, evaluator-private inputs, cohort inputs or
production data are stored here. The checker is read-only and writes no files.
The raw console transcript is not retained in Git; only the sanitized receipts
above are committed. The referenced launcher prompt lives outside the worktree
and only its SHA-256 and recovered slice body were used.

## Dispatch recovery note

The prompt text delivered to this slice ended at the `C-003-1` heading with the
slice body (explicit path list and checks) omitted. The authoritative body was
recovered from the launcher prompt named by the committed
`verification/research-program/bootstrap/pr003-native-launcher-v3-review.json`
and the recorded `prompt_sha256` in the PR-003 dispatch record; the recovered
file hash is `f3ae24ec04a5b8c92920fa1210399bd214ad9aa3bb4ad4773e930302fb10d07d`,
which matches the recorded value. See `dispatch-binding.json`.

## Limits and next consumer

- This is a fixture-level contract check, not independent verification. An
  implementer statement and a passing schema are not review approval.
- On-disk path containment, CLI behavior and full artifact re-hashing are
  C-003-2 (`scripts/research-program/check-handoff.mjs`,
  `tests/research-program/handoff.test.mjs`).
- Root `npm test` discovery is C-003-3 and is intentionally not changed here.
- `PR-001.json` and `PR-002.json` predate this schema and are not retroactively
  rewritten or claimed as validating.
- No commit is created by this one-shot slice; the controller inspects the diff,
  commits `C-003-1`, then dispatches C-003-2 in this worktree.
