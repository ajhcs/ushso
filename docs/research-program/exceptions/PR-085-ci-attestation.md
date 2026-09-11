# PR-085 — Current CI checks and immutable historical approval

Parent: PR-001; P1 / sub-phase 1A; requirement R16; findings F01 and F32.

Trigger: GitHub CI run 34541539731 on commit 487f06a756e3c23640dad08fc7f797643c8f186b failed verification/wp0/v1.4.0:validate with SUCCESSOR_APPROVAL_STALE_SUBJECT. Retained failed-log SHA256: dd0954b41ddd62306957b7de41a0b10296907313bcb02abb896aa0f06cb95e24. Independent host draft replay passed with current subject e5cbad48474dbcc40f3fabd172a0295bd141903bd6c08c38eb242f1daad8e475; historical approved subject is 0098ee424bc58120f48167c580b7db19b556d0aee42929d1da56664f78993cb5. No approval was issued.

The exact implementation-inventory delta is the newly published verification/research-program/bootstrap/pr004-additional-preliminary-checks.mjs. No sealed implementation file changed or disappeared; every other technical-evidence field was identical. This script is a retained independent replay, and later product changes will also change the same repository-wide subject.

PR-001 was bounded to baseline reconciliation and immutable historical receipts; PR-003 owns handoff validation/test discovery, and PR-004 owns field observations. Changing central contract-runner semantics belongs to a separate reviewed assignment with explicit ownership. PR-085 depends on accepted PR-001 and must be consumed by final PR-082. It is a current CI merge prerequisite where the old subject no longer matches; PR-003/004 may finish their independent implementation while it proceeds.

Owned files and three atomic commits are in the generated PR-085 packet. Reuse existing successor helpers, WP0 technical checks and the established distinction between historical attestation and current checks. Preserve direct successor validation/issuance semantics, every legacy test, prior receipt bytes, original approval scope and failure outcomes. Do not rename or omit executable files to hide them from the sealed inventory.

A passing result requires independent reproduction of changed-subject behavior, immutable historical pin checks, current technical failures still failing, and actual full root test/CI execution. The current technical draft remains pending approval when it differs from the historical subject. PR-082 must resolve current-subject successor approvals and the exact release gate; green development CI is not that decision.

The original R01–R16 predicates, cohorts, denominators and production boundaries are unchanged. Handoff/publication/review follow EXECUTION.md.


## Additional CI subject discovered by the full replay

PR-085 command cmd-0014-9cb38845 ran full npm test on the implementation at 7cfbb96096d5eba46c37fb5b1885f116aa82ab80 and failed the CI v1.3 validation. Independent draft replay proves the sole changed technical-evidence input is scripts/run-contract-suites.mjs, from 23,034 to 24,729 bytes. The historical approved CI subject is 11b8c7269bf293e67690d713a9e9748b977fb3197f039cb9966e5647d05d2ccb; the fresh unapproved subject is 59fcc355ec9c46599fa6afcbb7c91d9857532b3f3383c8fbc86fc5bbfd0ec098. These identities describe that candidate, not later code.

Independent replay on composed PR-003 bf46d92b0e4fc91457bd3eb78aa1742ae84038f2 also fails the old CI inventory's exact root npm-test sequence check. PR-003 deliberately registered its previously undiscovered handoff tests. The existing CI v1.3 implementation and approvals remain immutable; a versioned v1.4 inventory must represent this reviewed transition using actual current input bytes.

The PR-085 ownership extension is limited to a CI v1.4 workspace, its read-only attestation verifier and focused tests, and the required local workspace lock entries. The existing runner remains under its single PR-085 owner. Root package.json remains owned by PR-003. The original root sequence and the exact PR-003 extended sequence are the only supported transitional contracts; neither may lose a legacy gate or gain duplicate aggregate execution. The new CI suite preserves the prior integration-test behaviors and adds actual routing/failure cases.

Independent review of this amendment is required before implementation. No historical CI package, receipt or approval may change. Direct successor validation/issuance remains strict. The aggregate's current technical result does not issue current-subject approval or claim actual test execution from a structural inventory. Full combined checks and hosted CI remain mandatory before acceptance, and PR-082 retains both current approval decisions and final release qualification. The frozen cohorts, all R01–R16 targets, dependency graph, task count and planned atomic-commit count are unchanged.
