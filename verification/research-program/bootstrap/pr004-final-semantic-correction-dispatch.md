# PR004 final semantic corrections

Continue the same PR004 assignment as Luna Max. The user authorized the full project and provider delegation. Root has applied the separately reviewed metadata-only correction; do not recreate a checkout, change the branch, or alter historical receipts.

- Task: `ushso-pr004-field-states-20260910`
- Worktree: `/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr004-field-states-20260910`
- Branch: `codex/ushso-pr004-field-states-20260910`
- Start head: `cb74c3e7ffebd29341c2fca4f435cf36ef9e0485`
- Start tree: `e81d8c9ba6882e71a6a858e3320d630f5d8e117e`
- Historical dispatch base: `e5c44249b9d2448df2e4b6d466077658e42a009d`, tree `e2b9df441f1109187909d9ec2aeef7d8c7ca7bbf`
- Sole direct accepted dependency: PR002 merge `5647e81457b606bb36456e75c48f990ce21e9c6c`; PR001 `035465f3f16d15f02467679d96451d4440a36ca8` remains the transitive release baseline.
- Current reviewed integration plan: `481063cd76ab340323712662914866f3ba2fca08`, plan SHA256 `f1b70e63ba9add91c8aa2f70d89b5c398167aa891566eddec68624b32e9b1f15`. The PR004 packet and frozen denominators are unchanged. Do not merge this integration head merely for documentation.
- Root metadata receipt: `/mnt/d/tmp/plumbob/ushso-research-program-20260910/pr004-controller-binding-applied-v2/receipt.json`, SHA256 `e0f4b661fb62519d4a0199271835ee98a6f43394be3437352ddc33f55a4e9dc8`. The actual pinned PR003 checker passes after the two-file correction.

Read the existing PR004 packet, EXECUTION.md, applicable instructions and this independent review:
`/mnt/d/tmp/plumbob/ushso-research-program-20260910/pr004-final-semantic-review/receipt.json`
SHA256 `b327e8d982d66d4fc8f7e9239e7771779c27f5372e5522996ca8f99228389cb9`.

Fix these four specific acceptance defects, preserving the already passing controls:

1. Retain all eligible prior revisions from flat observation-ledger input in the published vector, history, evidence catalog and access summary. The older successful observation and distinct newer failed observation of one record/source/field currently cause the older observation to disappear when not explicitly nested in history. Prefer complete provenance-preserving reconstruction for legitimate flat ledger input over rejecting that input. Avoid duplicate counting when a revision is both supplied as a current flat observation and nested historical input; reject conflicting duplicate content rather than first-wins. The current failed attempt remains current and the earlier success remains historical.
2. Replace global first-wins history deduplication with an explicit identity rule that retains record/source/field/revision provenance. Two records or sources may reuse a local revision ID; they must not silently erase each other's successful history. Key by the full provenance identity, or reject a conflicting globally unique ID with a precise error if that is the declared schema contract. Use the same rule in vector/history/catalog/summary construction.
3. Independently assert all access-summary facts and boundaries, including documented credentials, costs, quotas and their evidence. Compare the full canonical normalized summary, resolving compact evidence form as needed. An altered unknown cost becoming free, altered credential or quota, or changed endpoint/top-level boundary must be rejected even if the attacker recomputes the artifact's self digest and supplies unchanged independent membership/cohort/generation/as_of/input context. Keep full and compact representations equivalent. Preserve the existing stronger external artifact digest check.
4. Use strict RFC3339 calendar-valid timestamp validation consistently in normalization, coverage and AJV date-time callbacks in verifier/tests. Reject impossible February dates and non-ISO Date.parse inputs in every nested clock. Preserve the valid generated_at > as_of case, while observations and nested evidence, access and browser clocks remain <= as_of. If the accepted format allows more than millisecond precision, do not silently truncate it for temporal ordering; either compare that supported precision correctly or explicitly constrain and validate the supported format. Keep this helper within your owned packages; PR003 has separate concurrent timestamp work.

The review's `decisive-replays.mjs` and `supplemental-replays.mjs` in that directory demonstrate these failures. They are diagnostic scripts that exit zero when reporting the current defect, so create meaningful regressions asserting the corrected behavior. Do not claim their exit code alone proves repair. Root will replay independent cases on the final head.

Owned paths remain only `packages/identity/schemas/`, `packages/normalization/`, `packages/coverage/`, `tests/research-program/field-states.test.mjs`, `docs/research-program/handoffs/PR-004.json`, and `verification/research-program/pr-004/`. Do not edit package.json/package-lock.json, PR003 validators, CI/WP0, frozen cohort/tasks/acceptance files, root ledger/plan, or production. Keep task-binding historical dispatch provenance intact.

Make one or two understandable additive correction commits following C4, with actual focused tests and a deterministic artifact rebuild/verification. Preserve all existing command receipts and indexes byte-for-byte; add an R2 evidence directory/index. Preserve the existing C4 evidence as historical, rather than rewriting old logs to imply new checks. Updating the current handoff and current generated artifact is expected; retain the prior artifact through immutable Git identity. Check registered normalization tests and validation, field-state tests, schema formats, decisive regressions, whole-catalog arithmetic, compact/full parity, frozen inputs and artifact hashes. No additional source or network qualification is requested.

Use the supported worktree-bootstrap writer lease and scoped escalation for this authorized worktree, not a fabricated writer token. Use the existing task/worktree/branch. If the previous agentctl lifecycle is terminal, start a new correction lifecycle scoped to this same bootstrap task and bind it honestly. Node >=22.15 and pinned npm11.19.1 are available at `/mnt/d/tmp/plumbob/ushso-research-program-20260910/tooling/node_modules/.bin/npm`. Do not replace node_modules or its ownership marker manually.

Run final handoff validation using the pinned `dc7267bf1c872f1457fa927e2d0403051575f474` PR003 checker under `/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr003-integrity-recovery-20260910/scripts/research-program/check-handoff.mjs` with repoRoot pointing to your PR004 worktree. Root owns integration against Grok's subsequent contract correction and the full combined release gate.

Report exact final head/tree, actual commands and counts, old/new artifact hashes and sizes, lifecycle receipt/hash, clean worktree and released writer lease, remaining limitations and downstream instructions. Do not merge, deploy or mark R01-R16 accepted. Pause only for a concrete scope or dependency conflict; send root the proposed bounded resolution while continuing unaffected corrections.
