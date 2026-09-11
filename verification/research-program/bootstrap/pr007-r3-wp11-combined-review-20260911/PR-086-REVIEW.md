# PR-086 independent review and actual combined-candidate result

Disposition: changes requested for candidate-independent tests. Producer HEAD cb9f5d846f36821540af158b455478fe0e2cdb87, tree f46abd2aff7fc65c2290dac14944fd4320c8bf30. Actual serving interface model grok-4; terminal cleanup normal/inactive_empty/unlocked. Root independently read back the clean producer head.

Standalone root review passed all four required commands, including 17 attestation tests and the actual selected WP11 suite. The root snapshot audit independently matched all 154 files / 1,347,732 bytes and the complete blob inventory against sealed receipt e596e1b18a0251f611990c9752e1d12fb36cd05dab16bf55cf96e8d1fc431f9d. Historical package, successor helper, runner and prior PR085 historical-pins/current-replay are byte-unchanged. Snapshot missing/extra/duplicate/tamper/substitution tests, strict direct successor validation/issuance, current-subject approval boundaries and actual child failure tests pass.

## R086-1 — Tests incorrectly treat the pre-PR005 tree as every future current tree

Root composed an actual isolated candidate from a11c675b66b25441355ffc9f66bec0f0b6125bc6:
- merge PR086 cb9f5d846f36821540af158b455478fe0e2cdb87 as e9a5310fcaa94ea2c89ff7b97183e45bf865179f
- merge PR005 afb90565456a429e73527f2bb99daf9cf174aa3c as 4fa2e0b5c8ee210cff9750a59e69df4b4a527fdc
- combined tree 18548bc7adfd12f2ea2992d1e96361ef83085844

On that exact clean candidate, the adapter and actual WP11 suite pass and report all 13 genuine current differences. Current technical subject is 534c3dc878f4413bb808e731008348b60d8e2f141b59d7f376bf613b1b26f028 and wrapper is 87fb320c9f415322f52581f3416ac760a58da684bdafd4592bac909bf182115a; both remain unapproved.

The focused attestation tests fail three cases (14 passed / 3 failed / 0 skipped):
1. tests/wp11-attestation.test.mjs:129 asserts current changed_count=2 and only package paths, but the actual candidate has 13 changes.
2. line307 assumes the pre-mutation current ResultCard.test.ts hash is the historical hash. Historical is 16226fad7dbbb87f6ca90541fcb33366b4104d8f7324e1f2373cff8446afe06d; the actual PR005 current file is f80476d8ba1a0343eaceae664b0f7aa1d4312105779b1c54cd5e2d91bbd85978.
3. line362 repeats changed_count=2 against the actual current tree.

Keep exact two-change assertions for an explicitly pinned pre-PR005 fixture. Current-candidate checks must independently compare all sealed historical entries with actual current bytes and verify the complete diff, including each path/hash/length and no approval transfer. Do not replace these with weak >=2 assertions, omit changed paths, or relabel current files as historical. Current-file mutation assertions must compare historical hashes to the retained historical inventory and current hashes to the actual before/after files.

The mutation case currently writes a tracked file in the test's own source checkout. Put the mutable current-candidate fixture in task-owned TMPDIR so concurrent readers cannot observe its temporary bytes; exercise real file changes with the actual builder/validator, preserving the full comparison.

## Evidence
All relative paths below are under /mnt/d/tmp/plumbob/ushso-research-program-20260910:
- pr086-controller-review/cb9f5d84/receipt.json and full command streams.
- pr086-controller-snapshot-audit-cb9f5d84.json (SHA f4e624b5cda778f0364bde1a647ce53c3773252d4e4b38068f224bd26973e1c5).
- pr005-pr086-initial-combined-candidate.json with exact merge provenance.
- pr005-pr086-combined-review/initial/receipt.json and full streams.
- compose-pr005-pr086-initial.py and pr005-pr086-combined-initial-commands.json.

Combined candidate worktree: /mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr005-pr086-controller-combined-20260911. It is review evidence, not accepted integration. Root retains the original PR005 producer binding; new PR086 dependency acceptance will be bound separately to the actual combined integration. No new approval, requirement acceptance, merge into the integration branch or deployment is claimed.
