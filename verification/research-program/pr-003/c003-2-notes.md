# PR-003 C-003-2 — handoff packet validation (evidence)

Sanitized evidence for slice `C-003-2 — Validate handoff packets` of
[PR-003](../../../docs/master-plan/2026-09-10/prs/PR-003.md). This file is new in
C-003-2; the C-003-1 artifacts in this directory are left unchanged.

## Deliverables

| Path | Purpose |
| --- | --- |
| `scripts/research-program/check-handoff.mjs` | Validator: accepts one handoff JSON path; enforces path containment, file existence, SHA-256 binding, dependency SHA matching, cross-reference rules and local Git commit/ancestry binding. |
| `tests/research-program/handoff.test.mjs` | Focused `node:test` suite (9 tests) over the fixtures, containment helper and CLI exit codes. |
| `fixtures/handoff.reject-artifact-hash-mismatch.json` | Additional negative packet: a declared artifact SHA-256 that does not match the on-disk bytes. |
| `command-receipts/cmd-c003-2-*.json` | Sanitized receipts with actual start/end, exit codes and expected-versus-actual observations. |
| `c003-2-evidence-index.json` | Hash index for the C-003-2 artifacts. |

## Validator contract

```bash
node scripts/research-program/check-handoff.mjs <handoff.json>
```

Exit codes: `0` accepted, `1` rejected, `2` usage/operational error. The report
is typed JSON on stdout with `ok`, `outcome`, `checks[]`, `findings[]`,
`notes[]`, `preserved_outcomes` and `independent_review` (`not_claimed`).

Enforced checks:

* **Path containment** — the handoff path, every `artifacts[].path`, every
  repository-path `source_identities[].id` and every `changed_files[]` entry
  must stay inside the repository root, both lexically and after symlink
  resolution.
* **File existence** — every referenced artifact and repository-path source
  identity must exist as a regular file.
* **SHA-256 binding** — every artifact (and byte length, when declared) and
  every repository-path source identity is re-hashed and compared.
* **Dependency SHA matching** — `dependency_merge_shas` must match a sibling
  `task-binding.json` and the committed
  `docs/research-program/execution-ledger.json`; a conflict between the two is
  reported as `binding_conflict`. `base_sha` is compared to the task binding
  when one is present.
* **Local Git binding** — the base SHA must be a local commit and every
  dependency SHA a local ancestor of it.
* **Cross references** — a success acceptance state needs a resolvable command
  with a non-empty result; artifact references must resolve. Non-pass outcomes
  (`failed`, `blocked`, `unavailable`, `unresolved`, `pending`) are preserved in
  `preserved_outcomes.non_pass_acceptance_results` and never converted to a
  pass.

`ok:true` means the packet is complete and evidence-bound. It is **not**
independent verification; the validator always reports
`independent_review.status = "not_claimed"`.

## Reproduce

```bash
node --test tests/research-program/handoff.test.mjs
node scripts/research-program/check-handoff.mjs verification/research-program/pr-003/fixtures/handoff.valid.json
node scripts/research-program/check-handoff.mjs verification/research-program/pr-003/fixtures/handoff.reject-claimed-pass-without-command.json
node scripts/research-program/check-handoff.mjs verification/research-program/pr-003/fixtures/handoff.reject-missing-artifact.json
node scripts/research-program/check-handoff.mjs verification/research-program/pr-003/fixtures/handoff.reject-stale-dependency-sha.json
```

Expected: the focused suite exits `0` with 9 passing tests; the valid packet
exits `0` (`ok:true`) and each incomplete packet exits `1` for its declared
rule. See `command-receipts/` for the executed receipts.

## Limits and next consumer

- This is producer-side validation. Passing it is not Astra's independent review
  and not scientific approval.
- The packet is bound to base `e5c44249…`; HEAD is the C-003-1 commit
  `601072e9…`, so `head_sha` remains `null` until the controller commits.
- `npm test` discovery is intentionally unchanged: the existing
  `tests/*.test.mjs` glob does not recurse, so the focused suite is run
  explicitly. C-003-3 wires `test:research-program` into the root chain.
- No commit is created by this one-shot slice; the controller inspects the
  allowlisted diff and commits C-003-2.
