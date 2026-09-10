# PR-003 C-003-3 — PR guidance and test discovery (evidence)

Sanitized evidence for slice `C-003-3 — Wire PR guidance and test discovery` of
[PR-003](../../../docs/master-plan/2026-09-10/prs/PR-003.md). The C-003-1 and
C-003-2 artifacts in this directory are left unchanged.

## Deliverables

| Path | Purpose |
| --- | --- |
| `.github/pull_request_template.md` | PR body fields from EXECUTION.md and `templates/pr-body.md`, exact base/head/dependency SHA fields, links to the sanitized handoff and evidence, GitHub branch/PR commands, and the draft-PR / review-state rules. |
| `package.json` | Registers `test:research-program` as `node --test tests/research-program/*.test.mjs` and adds it to the root `test` chain; every pre-existing script is preserved. |
| `docs/research-program/handoffs/PR-003.json` | The task-specific PR-003 handoff, conforming to `handoff.schema.json`. |
| `verify-pr-guidance.mjs` | Bounded local checker: template fields/guidance/states, placeholder-free example body, package-script registration and glob selection. |
| `draft-pr-body.example.md` | Filled example body proving an intern can submit a draft PR from the template. |
| `command-receipts/cmd-c003-3-*.json` | Sanitized receipts with actual start/end, exit codes and expected-versus-actual observations. |
| `c003-3-evidence-index.json` | Hash index for the C-003-3 artifacts. |

## Why a new script is required

The existing worker command is `node --test tests/*.test.mjs`; that shell glob
is not recursive, so `tests/research-program/handoff.test.mjs` was never
discovered. `test:research-program` uses the explicit directory glob and is
inserted into the root chain after `test:worker`:

```text
npm run test:retrieval && npm run test:web && npm run test:worker
  && npm run test:research-program && npm run test:evaluation
  && npm run validate:evaluation && npm run verify:research-navigator
```

## PR template contract

`verify-pr-guidance.mjs` asserts that the template carries 14 body fields
(assignment, integration base SHA, exact candidate head SHA, dependency merge
SHAs, source/corpus/schema/model identities, resulting behavior, verification
with exact commands/exits, decisive replay check, handoff link, sanitized
evidence link, failures/limits, rollback, GitHub submission, review state),
9 review-guidance anchors and all 12 EXECUTION.md review states. It also asserts
that the filled example body resolves every field with no `PR-xxx`, angle
bracket or `TODO`/`TBD` placeholder.

The guidance encodes the required rules verbatim: a PR stays a **draft** until
producer checks and handoff validation pass; **Astra independently replays the
decisive check**; a changed head invalidates review; and there is **no automatic
merge or deployment** and no producer self-merge.

## Reproduce the decisive checks

```bash
node --test tests/research-program/handoff.test.mjs
npm run test:research-program
node verification/research-program/pr-003/verify-pr-guidance.mjs
node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-003.json
```

Expected: the focused suite exits `0` with 9 passing tests; `npm run
test:research-program` runs the same 9 tests through the registered script; the
guidance checker exits `0` with `ok:true` and zero failures; and the PR-003
handoff is accepted by `check-handoff.mjs`. See `command-receipts/` and
`c003-3-evidence-index.json`.

## Limits and next consumer

- This is producer-side guidance/package validation. It is not an `npm test`
  end-to-end run (that is the CI/integration gate, and CI already invokes
  `npm test`), not Astra's independent review and not scientific approval.
- Push and draft-PR creation are intentionally unclaimed: this one-shot slice
  is local and network-free. The controller commits the allowlisted diff and
  opens the draft PR with the body file.
- `head_sha` in `docs/research-program/handoffs/PR-003.json` is `null` because
  the slice cannot name its own not-yet-created commit. The controller records
  the exact head after the commit exists, then re-runs the validator.
- No sibling `docs/research-program/handoffs/task-binding.json` is added: the
  validator resolves the PR-003 dependency SHAs from the committed
  `docs/research-program/execution-ledger.json`. A single shared sibling
  binding file would be PR-003-specific and would wrongly reject later
  `PR-004`…`PR-084` handoffs in the same directory.
- Astra's next action: replay `node scripts/research-program/check-handoff.mjs
  docs/research-program/handoffs/PR-003.json` and `npm run
  test:research-program` on the reviewed head, then confirm the draft PR body
  came from `.github/pull_request_template.md` with exact SHAs and no
  auto-merge.
