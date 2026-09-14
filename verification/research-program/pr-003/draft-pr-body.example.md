# PR-003 draft body (filled example)

This file is the sanitized, filled example that demonstrates an intern can
submit a draft PR from `.github/pull_request_template.md`. It contains no
unresolved placeholder tokens. The head SHA is deliberately honest: this
one-shot slice cannot name its own not-yet-created commit, so the controller
records the exact head after the commit exists.

## Summary

Adds the PR-003 task/handoff schemas, the bounded `check-handoff.mjs` validator
with its focused test suite, and wires PR body guidance plus
`test:research-program` into root test discovery so every implementer PR
arrives with reviewable, machine-checkable evidence.

## Assignment

- PR ID: PR-003
- Phase / sub-phase: P1 / 1A
- Requirement / finding IDs: R16; audit findings F01, F32
- Owner (provider and model): DeepSeek (`deepseek/deepseek-v4.1-flash`, reasoning `high`)
- Reviewer: Astra
- Named human owner / domain decision, if any: none required at dispatch

## Provenance and SHA binding

- Integration base SHA: `e5c44249b9d2448df2e4b6d466077658e42a009d`
- Exact candidate head SHA: not-yet-committed; the controller records the exact
  head after this one-shot slice exits (the handoff keeps `head_sha: null`)
- Dependency merge SHAs:
  - PR-001: `035465f3f16d15f02467679d96451d4440a36ca8`
  - PR-002: `5647e81457b606bb36456e75c48f990ce21e9c6c`
- Branch: `codex/ushso-pr003-deepseek-20260910t220020z`
- Source / corpus / schema / model identities affected:
  `docs/master-plan/2026-09-10/EXECUTION.md`,
  `docs/master-plan/2026-09-10/prs/PR-003.md`,
  `docs/research-program/handoffs/schema/task.schema.json`,
  `docs/research-program/handoffs/schema/handoff.schema.json`,
  `scripts/research-program/check-handoff.mjs`,
  `tests/research-program/handoff.test.mjs`
- Worktree and tool versions (Node, npm):
  `/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr003-deepseek-20260910t220020z`;
  Node `v24.14.0`; npm `11.19.1`

## Handoff and sanitized evidence links

- Task handoff: `docs/research-program/handoffs/PR-003.json`
- Sanitized evidence index: `verification/research-program/pr-003/c003-3-evidence-index.json`
- Slice notes: `verification/research-program/pr-003/c003-3-notes.md`
- Durable CI / GitHub artifact link with documented retention: none; the
  sanitized artifacts are small and committed under
  `verification/research-program/pr-003/`
- Confirmation: no private raw logs, credentials, evaluator-private material,
  cohort inputs or production data are committed or linked here. Yes

## Resulting behavior

`docs/research-program/handoffs/` now carries the machine-checkable task and
handoff/receipt schemas and the first conforming PR-003 handoff;
`scripts/research-program/check-handoff.mjs` validates one handoff packet
against path containment, file existence, SHA-256, dependency and command
cross-reference rules; `tests/research-program/handoff.test.mjs` exercises the
validator; and `.github/pull_request_template.md` plus the root
`test:research-program` script make the evidence and review states part of the
normal PR flow. Typed failed/blocked/unavailable/unresolved outcomes are
preserved and never coerced to a pass. No deployment, source access,
scientific approval or independent review is claimed.

## Verification

| Command | Exit | Expected | Actual |
| --- | --- | --- | --- |
| `node --test tests/research-program/handoff.test.mjs` | `0` | valid packet accepted; claimed-pass-without-command, missing-artifact and stale-dependency-SHA rejected | 9 tests, 9 pass, 0 fail |
| `npm run test:research-program` | `0` | the new script runs the same focused suite | 9 tests, 9 pass, 0 fail |
| `node verification/research-program/pr-003/verify-pr-guidance.mjs` | `0` | template fields, review-state guidance and root test-chain registration all present; example body has no placeholder | `ok: true` |
| `node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-003.json` | `0` | the PR-003 handoff is schema-valid and evidence-bound | `ok: true`, zero findings |

- Decisive check for independent replay:
  `node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-003.json`
  followed by `npm run test:research-program`.
- Fixture / artifact paths and SHA-256:
  `verification/research-program/pr-003/c003-3-evidence-index.json`
- Full `npm test` / `npm run build` / `npm run cf:dry-run` gate: run at the
  integration or release gate, not claimed from producer checks.

## Failures, skipped checks and remaining limits

- Full `npm test` end-to-end is a CI / integration-gate check and was not run
  by this one-shot slice; only the focused suite and package-script selection
  were executed.
- GitHub push and draft-PR creation are not claimed: this slice is local and
  network-free. The controller performs the ordinary Git commit and launch.
- `head_sha` stays `null` until the controller commits, so `base_sha_binding`
  is `not_applicable` and the handoff is bound through the committed execution
  ledger.
- Independent review has not started; Astra must replay the decisive check on
  the reviewed head.

## Rollback or compatibility impact

Reverting this change removes the `test:research-program` script from the root
`test` chain and the PR template guidance; no runtime, corpus, schema or
production behavior changes. Existing package test scripts are preserved.

## GitHub submission

Run from the isolated worktree. Do not paste credentials or secrets.

```bash
git push -u origin codex/ushso-pr003-deepseek-20260910t220020z
gh pr create --draft --title "Make implementer handoffs and review evidence enforceable" --body-file verification/research-program/pr-003/draft-pr-body.example.md
gh pr view --json isDraft,headRefOid,url
```

## Review state

Current state: `producer_checked`

Draft PR lifecycle: the PR stays a draft until producer checks and handoff
validation pass; Astra independently replays the decisive check on the exact
reviewed head; a changed head invalidates review; there is no automatic merge
or deployment, and no producer self-merge.
