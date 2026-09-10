# PR-085 — Current CI checks and immutable historical approval

Parent: PR-001; P1 / sub-phase 1A; requirement R16; findings F01 and F32.

Trigger: GitHub CI run 34541539731 on commit 487f06a756e3c23640dad08fc7f797643c8f186b failed verification/wp0/v1.4.0:validate with SUCCESSOR_APPROVAL_STALE_SUBJECT. Retained failed-log SHA256: dd0954b41ddd62306957b7de41a0b10296907313bcb02abb896aa0f06cb95e24. Independent host draft replay passed with current subject e5cbad48474dbcc40f3fabd172a0295bd141903bd6c08c38eb242f1daad8e475; historical approved subject is 0098ee424bc58120f48167c580b7db19b556d0aee42929d1da56664f78993cb5. No approval was issued.

The exact implementation-inventory delta is the newly published verification/research-program/bootstrap/pr004-additional-preliminary-checks.mjs. No sealed implementation file changed or disappeared; every other technical-evidence field was identical. This script is a retained independent replay, and later product changes will also change the same repository-wide subject.

PR-001 was bounded to baseline reconciliation and immutable historical receipts; PR-003 owns handoff validation/test discovery, and PR-004 owns field observations. Changing central contract-runner semantics belongs to a separate reviewed assignment with explicit ownership. PR-085 depends on accepted PR-001 and must be consumed by final PR-082. It is a current CI merge prerequisite where the old subject no longer matches; PR-003/004 may finish their independent implementation while it proceeds.

Owned files and three atomic commits are in the generated PR-085 packet. Reuse existing successor helpers, WP0 technical checks and the established distinction between historical attestation and current checks. Preserve direct successor validation/issuance semantics, every legacy test, prior receipt bytes, original approval scope and failure outcomes. Do not rename or omit executable files to hide them from the sealed inventory.

A passing result requires independent reproduction of changed-subject behavior, immutable historical pin checks, current technical failures still failing, and actual full root test/CI execution. The current technical draft remains pending approval when it differs from the historical subject. PR-082 must resolve current-subject successor approvals and the exact release gate; green development CI is not that decision.

The original R01–R16 predicates, cohorts, denominators and production boundaries are unchanged. Handoff/publication/review follow EXECUTION.md.
