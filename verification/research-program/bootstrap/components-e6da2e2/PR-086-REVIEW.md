# PR-086 R2 independent review

Disposition: the correction passes standalone and actual combined independent checks. Full release gate and hosted combined CI remain required for integration acceptance.

Reviewed producer HEAD fc246d03463bb85e3892b443120c60b6206aae4a, tree 1b3ce008337e4bf5e8e6d4f956c49a770ed8c5d8. Root independently read back the clean producer worktree and reviewed the complete cb9f5d84-to-fc246d03 implementation and test diff. The supported provider interface was grok-4. Terminal cleanup was normal/inactive_empty/unlocked.

All four standalone root commands passed, including 17 attestation tests, the adapter, the actual WP11 suite and handoff validation. The retained receipt is pr086-controller-review/fc246d03/receipt.json. The correction leaves the historical package, snapshot, reader, policy, successor helper, general runner and predecessor receipts unchanged.

R086-1 is corrected: current-candidate assertions independently compare all 154 sealed historical entries against actual current file bytes, then compare every changed path, hash and length with the adapter output. The exact two-change assertion now belongs only to an explicitly named pre-PR005 fixture. It is not used as a universal current-tree expectation. The corrected PR005 fixture also uses the complete independent comparison.

The mutation test copies the necessary current input files into task-owned TMPDIR and exercises the actual builder and validator there. It compares retained historical hashes and actual before/after current hashes without temporarily modifying a tracked source file. Strict direct validation, future-route enforcement, real child-suite failure, and negative snapshot integrity tests remain present.

Root composed this correction with PR005 afb90565456a429e73527f2bb99daf9cf174aa3c and PR007 fa624903123dac858650730ee71bf7f8cb3c34ef at e6da2e2d87c95501e5a1b129989e17bdae3cb882, tree a9d9bca698ffc403a9ad1b82a8c8328af01146aa. All ten combined command groups passed. The independent comparison confirms all 13 current differences across the 154 historical entries. Historical subject 294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98 retains its original historical receipt. Combined current technical subject 534c3dc878f4413bb808e731008348b60d8e2f141b59d7f376bf613b1b26f028 and wrapper subject 822c69777c46a237eefb7da3e299854b1562ec1ac726ef1c9fa37add2c2530eb remain distinct and unapproved.

The combined controller's original receipt-finalization script addressed base_sha at the wrong JSON level after every command and byte check passed. A guarded post-processing correction read task-binding.binding, revalidated every retained stream hash and unchanged source byte, and wrote the preflight without rerunning tests or merging again. Both the original script and the correction receipt are retained. This is controller bookkeeping evidence, not a product failure or a new test run.

Original failed results remain in the previous published review. The PR005 original producer binding still names its original base and PR004 dependency; the subsequently added PR086 dependency is bound separately to the actual combined merge. No R01–R16 acceptance, new historical/current approval, payload qualification, integration acceptance or deployment is claimed here.
