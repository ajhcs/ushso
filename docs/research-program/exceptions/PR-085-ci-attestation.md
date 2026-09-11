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


## Exact WP11 current-subject boundary

The retained full npm-test command cmd-0022-aa4a557b failed at WP11 v1.3.0 validation with SUCCESSOR_APPROVAL_STALE_SUBJECT. Root Astra independently repeated the read-only draft and strict validation on PR085 final head 4f90157108a92ce9541c340d5536eac31f24a1d8 (tree ba468220ab24bb560d2f8fb6bac83aa94ee61070). The draft passed current technical checks and remained pending with null approval and release flags false; strict validation exited 1. The original subject is 294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98; that candidate's current subject is 8d3409bc360d9b295c5c21f9b1a2d6ad91f42ff5c946a14aff92cd4b7d97c259. Only package-lock.json changed across its 154 approved input pins, from af2070ae111bc67c397b07e33b44c1fbd15bba31b63210990068943998e1bc28 to 37e4a9ec1fba9ab254aa7a596e1a0e3f73919cf5358717dc6e06e0478be6b20c. These subjects identify this diagnostic candidate, not a future combined release.

The additional ownership is exactly scripts/verify-wp11-attestation.mjs, tests/wp11-attestation.test.mjs and the versioned policy/evidence directory verification/research-program/ci-attestation/wp11-v1.3.0/. The existing runner remains under its single PR085 owner. This uses the existing WP11 v1.3 package and creates no workspace or dependency change. The adapter validates complete immutable historical proof, invokes the existing current technical checks and records current implementation identities and pending status. Its aggregate route matches the exact alias, path, version, package and validate command. Direct WP11 validation/issuance and future versions retain their strict behavior.

All selected packages are being audited independently before another combined gate. This scope does not infer that a textual hash difference elsewhere is an executable failure or authorize changing another package. Any different validated failure requires its own bounded scope and review before edits. This amendment is pending separate review; it is not an issued current-subject approval.

The combined-input preflight found no conflicting source edits and one handoff-context mismatch: PR085 records its original package.json as local even though PR003 contributes a different reviewed manifest. Preserve the original bytes through an explicit Git-snapshot source identity and name the current transition separately; never rewrite an old receipt to conceal this distinction. The final combined handoff check is required.

PR082 retains the WP0, CI and WP11 current-subject decisions and all independent release qualification. The initial 84-PR/252-commit baseline, current 85-PR/255-planned-commit model, graph, acceptance thresholds and frozen denominators remain unchanged. The full combined tests/build/Cloudflare dry-run and hosted CI remain mandatory. No production, enrichment-spend or scientific permission is inferred.
