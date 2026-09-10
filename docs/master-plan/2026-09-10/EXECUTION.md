# Execution and independent review protocol

This protocol accompanies every [PR assignment](PR-INDEX.md). The planned implementers are Luna Max, Grok and DeepSeek. The controller assigns one owner per PR based on current capability and access; no external implementation jobs were launched by this planning task. Astra owns independent review, integration and final frontend work.

## One assignment, one worktree, one branch

1. Read repository/host instructions and the PR's prerequisites. Use PR-001's verified integration base; the original workspace is dirty and stale. Never reset or stash someone else's changes to start a task.
2. Verify `/mnt/d` is mounted. Use `/home/plumbob/bin/with-dev-storage`, worktrees under `/mnt/d/worktrees/plumbob`, scratch under `/mnt/d/tmp/plumbob`, and caches under the prescribed cache root. Read relevant host notes before runtime, storage, authentication, deployment or networking work. Check listeners before binding a server.
3. Use `codex/pr-<number>-<short-name>` and one isolated checkout. Git administrative writes use scoped escalation under the host instructions. Destructive history edits, production mutations and pushes follow the actual existing authorization.
4. Receive a dispatch packet with exact base SHA, dependency merge SHAs, permitted paths, source/fixture IDs, task objective, commits, checks and evidence destination. All provider transmissions use the minimum sanitized task material. Production environment files, credentials and private data are never sent as general implementation context.
5. Mark the task `in_progress` in the execution ledger. Reserve shared-file ownership. If the task needs a contract change outside its scope, propose the interface delta and coordinate with the owner before editing.

Do not run concurrent assignments that own the same central file. Common hot spots include `worker/index.mjs`, `App.tsx`, `styles.css`, shared contracts, the lockfile and source manifests. Contract producers land first; downstream tasks consume their actual merged artifacts. Parallelism is useful for CMS/CDC/Census adapters, separate document parsers, hospital/payer parsing and independently scoped content. It is not permission to let several agents regenerate the same corpus or approval receipts.

## Atomic commit discipline

Each PR packet specifies three commits. A commit contains one coherent behavior/schema/content change with its meaningful tests or artifact checks. Keep format-only changes out of functional fixes. Do not create a broken first commit that merely asserts a future implementation's behavior; schema/fixture commits should test the new contract independently, and implementation commits add their regression coverage.

Before each commit, inspect the diff for unrelated changes, source/secret leakage, generated artifact drift and undocumented public behavior. Use an imperative subject from the packet or an equally precise revision. After each commit, append its SHA and verification result to the task handoff. Do not invent a successful command, hide skipped checks or replace a failed source response with a synthetic successful fixture.

PR scopes are intended to be bounded. If an actual source format needs a substantial new parser or a shared interface changes, split the work before it grows into a large implementation. Add a new stable PR ID, parent requirement/finding, owned paths, atomic commits and dependency edges; regenerate and validate the plan. This is required engineering discovery, not a reason to leave the final acceptance goal incomplete.

## Communication and retained notes

Use `docs/research-program/execution-ledger.json` for task state/owner/dependency pointers. Keep substantive per-task handoffs in `docs/research-program/handoffs/PR-xxx.json`. Store append-only significant events under the evidence directory; keep routine private console logs out of Git. A handoff must contain:

- Exact base, head, dependency SHAs and changed files.
- Problem, resulting behavior and intended downstream consumer.
- Contract/source/corpus/schema/model versions and hashes as applicable.
- Commands, start/end times, exit codes, fixture names and actual versus expected observations.
- Sanitized artifact paths/hashes and a durable CI/GitHub artifact link when the raw evidence is too large for Git.
- Known failures, skipped checks, unresolved scientific claims, source access blockers and next action.
- Any interface decision needed by another implementer, with the affected task IDs.

Notify the controller when a shared interface changes, a dependency becomes available, a task blocks on an external fact, or a reviewable PR is ready. Do not send routine success chatter. Keep discussions in the authorized task coordination channel and GitHub PR; do not send email or Slack messages without authorization. The controller forwards concise contract changes to affected implementers. A conversation-only statement is not the durable handoff.

Use explicit states: `planned → ready → in_progress → producer_checked → draft_pr → independent_review → changes_requested | independently_verified → merged → integrated → qualified`. `blocked` must state the exact missing dependency/input, what independent work is complete and how to resume. A merged PR is not necessarily a qualified product capability.

## GitHub submission

Every implementation task pushes its branch and opens or updates a draft PR in the verified `ajhcs/ushso` repository when that action is within the task's authorization. Use a body file with real newlines; never interpolate secrets or command substitutions into a shell command. Include the [PR body template](templates/pr-body.md), dependencies, exact head and links to handoff/evidence. The title describes the final behavior, not the history of attempts.

If GitHub access is unavailable, finish the local commits and review packet, record the concrete blocker, and leave push/PR creation unclaimed. Do not post a message pretending a PR exists. Never self-merge or deploy from an implementer task. After changes are requested, update the same PR unless the scope was intentionally split; invalidate review on a changed head and rerun the affected checks.

The original data-audit raw bodies, dictionary files and browser captures are local evidence. Do not automatically commit tens of thousands of files or bulk source rows. Keep small fixtures needed for tests, a manifest with hashes and a licensed/sanitized durable artifact for large evidence. GitHub artifacts need a documented retention period long enough for review and release reproduction; an expiring link alone is not permanent provenance.

## Verification hierarchy

| Level | What it proves | Required evidence |
|---|---|---|
| Contract/unit | Local invariants and field semantics | Meaningful positive/negative fixtures with exact expected outcomes |
| Integration | Actual components work together | Real repository/client/parser composition, not a mocked top-level success |
| Data test | A specific source operation worked | Source/request/context, time, content/shape checks, byte/hash identity and scope |
| Scientific review | A claim has justified interpretation | Exact proposed value, authoritative passage, alternatives, reviewer and rationale |
| Cross-surface | Users and tools see the same facts | Actual HTTP, stdio MCP, native WebMCP and rendered UI results on one candidate |
| User validation | Intended users can finish tasks | Moderated novice/advanced task observations and misinterpretation checks |
| Release/operation | The accepted product is the deployed and maintained product | Locked build, exact artifact, staging/production checks, recovery and sustained-refresh evidence |

Run appropriate existing package tests for changed behavior. Add tests that can detect a real failure, not tests that merely restate implementation literals. Documentation-only edits use link/example/identity checks. Full `npm test`, `npm run build` and `npm run cf:dry-run`, plus the repository's applicable release gate, are integration/release checks. Build scripts may stage generated files; use the isolated candidate, never the dirty original workspace.

PR-003 adds the new `tests/research-program/*.test.mjs` suite to root test discovery. The existing `tests/*.test.mjs` worker command does not recurse into that directory. Individual PR packets provide the exact planned Node test command and existing package checks where applicable. After PR-003 lands, validate a handoff with `node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-xxx.json`, substituting the actual ID; initial bootstrap tasks retain the same fields for retrospective validation.

Network tests use approved public source scopes, budgets and no-PHI fixtures. External data collection, a paid model call and a production deployment are different operations with different applicable authorization. Model mocks validate the integration; they do not qualify a model's extraction quality. One sample row validates only the tests actually performed on that row. A typed unknown can be a correct error-contract test while still failing the intended research task.

## Astra's review checklist

For every PR, Astra reviews the final diff and handoff against its acceptance contract, verifies artifact hashes and reruns at least the decisive regression/integration checks appropriate to the change. Scientific fields receive evidence review; parser output is sampled across source/layout/field classes rather than only the producer's easiest example. Additional review focuses on units, grain, date roles, denominators, restrictions, identity and joins.

Reject a PR that:

- Converts unknown to an invented fact, source absence, free access or a successful check.
- Treats labels/concepts as definitions, inferred tags as grain, or a metadata timestamp as observation coverage.
- Uses copied corpus fixtures as proof of fresh source access.
- Passes sample/full-file validation by counting fields without comparing identifiers and contexts.
- Changes source/generation/approval identity without an explicit transition.
- Uses model agreement as scientific evidence or stores private data in prompts/logs.
- Claims native MCP, browser, accessibility or production verification that was not actually executed.
- Adds a beautiful UI over empty essential fields or leaves a control without real behavior.

After fixes, review the new exact head. Preserve the initial failing receipts so downstream reviewers can see what changed. The independent review should say **what changed, why it matters, which decisive checks passed, and what remains outside the evidence**. Astra's final frontend PR is PR-075; PR-079/081/082 provide independent data, package and release closure.

When Astra authors a substantive code change, identify that authorship in the review record. Astra still runs the final verification, but cannot claim independence from its own implementation. Obtain a second review of that patch from a separate reviewer or the owner; the final program evidence distinguishes this from Astra's review of other implementers' work.

## Scientific decisions without a review bottleneck

Literal publisher metadata may be promoted by an explicitly approved deterministic rule after schema/evidence/context validation. High-impact interpretations and ambiguous identities require an exact review record. Do not require the owner to manually approve 1.57 million literal labels. Instead, use stratified validation and a published rule that can be revoked/replayed when defects are found.

For the model evaluation, record confidence intervals alongside point precision and sample sizes; require the R14 threshold on a sufficiently large, independently adjudicated held-out set, and zero critical errors. A point estimate from a handful of easy examples cannot justify general scientific promotion. Keep per-source/task-class results so large Census dictionaries do not conceal errors in CMS financial or MRF price meanings.

## Final acceptance and closure

PR-082 consumes all prior implementation/acceptance work. The owner receives a concrete exact-candidate release packet, including costs, operational changes and rollback, before any required final authorization. No file in this planning package authorizes new production infrastructure or a paid provider call.

PR-084 requires real sustained observation; it cannot pass on day zero. If empirical targets fail, add bounded remediation work and update the dependency model. A stakeholder can explicitly amend a requirement with reasons and visible impact, but an implementer cannot lower a threshold to obtain a green gate. Completion means current evidence satisfies the accepted requirement set, not that the initial list of 84 PRs has been exhausted.
