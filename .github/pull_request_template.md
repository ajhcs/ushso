<!--
ushso pull request template (PR-003 C-003-3).

Read docs/master-plan/2026-09-10/EXECUTION.md and the PR packet before filling
this in. Use a body file with real newlines. Never interpolate credentials,
tokens or command substitutions into a shell command. Keep private raw logs,
evaluator-private inputs, cohort inputs and production data out of the body.

Every field below is required unless it is explicitly marked optional. A
reviewer must be able to replay the decisive check from this body, the handoff
at docs/research-program/handoffs/PR-xxx.json and the sanitized evidence index
without reading a chat transcript.
-->

## Summary

<!-- One or two sentences naming the concrete problem and the resulting behavior. -->

## Assignment

- PR ID: PR-xxx
- Phase / sub-phase: 
- Requirement / finding IDs: 
- Owner (provider and model): 
- Reviewer: Astra
- Named human owner / domain decision, if any: 

## Provenance and SHA binding

- Integration base SHA: `<40-hex base SHA>`
- Exact candidate head SHA: `<40-hex head SHA>`
- Dependency merge SHAs:
  - PR-001: `<40-hex merge SHA>`
  - PR-002: `<40-hex merge SHA>`
- Branch: `codex/<branch-name>`
- Source / corpus / schema / model identities affected: 
- Worktree and tool versions (Node, npm): 

## Handoff and sanitized evidence links

- Task handoff: `docs/research-program/handoffs/PR-xxx.json`
- Sanitized evidence index: `verification/research-program/pr-xxx/<index>.json`
- Slice notes: `verification/research-program/pr-xxx/<notes>.md`
- Durable CI / GitHub artifact link with documented retention: `<url or "none">`
- Confirmation: no private raw logs, credentials, evaluator-private material,
  cohort inputs or production data are committed or linked here. Yes / No

## Resulting behavior

<!-- What changed, including changed uncertainty, access or typed-outcome
behavior. State disabled-feature boundaries and non-authoritative projections
that are preserved. -->

## Verification

| Command | Exit | Expected | Actual |
| --- | --- | --- | --- |
| `<exact command>` | `<exit>` | `<expected>` | `<actual>` |

- Decisive check for independent replay: `<exact command>`
- Fixture / artifact paths and SHA-256: 
- Full `npm test` / `npm run build` / `npm run cf:dry-run` gate: run at the
  integration or release gate, not claimed from producer checks.

## Failures, skipped checks and remaining limits

- Failed or blocked checks (preserve the failing receipt and the exact missing
  input): 
- Skipped checks and why: 
- Unresolved scientific claims and source-access blockers: 

## Rollback or compatibility impact

<!-- Migration, rollback and compatibility notes. -->

## GitHub submission

Run from the isolated worktree. Do not paste credentials or secrets.

```bash
git push -u origin <branch>
gh pr create --draft --title "<final behavior, not attempt history>" --body-file <body-file>
gh pr view --json isDraft,headRefOid,url
```

## Review state

Current state: `<planned | ready | in_progress | producer_checked | draft_pr | independent_review | changes_requested | independently_verified | merged | integrated | qualified | blocked>`

Draft PR lifecycle (from EXECUTION.md):

- The PR is opened and kept as a **draft**. It remains a draft until the
  producer checks pass **and** handoff validation passes, for example:
  `node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-xxx.json`.
- The producer never self-merges and never deploys. There is **no automatic merge or deployment** from this task.
- **Astra independently replays the decisive check** on the exact reviewed head
  SHA; producer logs alone are not approval.
- A changed head invalidates review: rerun the affected checks and record the
  new exact head SHA before requesting review again.
- Do not claim deployment, source access, scientific approval or independent
  review from a producer test. A passing schema is not scientific approval and
  a successful tool envelope is not a completed research task.
- If a dependency, source, fixture or command is missing, retain the typed
  blocked / failed / unavailable / unresolved outcome and name the exact missing
  input instead of inventing a result.
