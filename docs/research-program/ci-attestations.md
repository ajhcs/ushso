# PR-085 - Current CI checks and immutable historical approval

PR-085 addresses the repository-wide subject change that made the stored WP0 v1.4.0 approval stale. The implementation is a bounded CI attestation check and runner route. It does not issue a current approval, qualify a release, enable production behavior, or evaluate R01-R16.

## Candidate and ownership

The candidate started at 30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0 (tree 8707c8fc92f35742f58508a83a57a3c4d9b7baf4). The completed implementation candidate before C3 publication documentation is 7cfbb96096d5eba46c37fb5b1885f116aa82ab80 (tree e441cd19fe08971dae42c341ac2d1edbf44f25cb). The three planned commits are C-085-1 0d82cb98dc7ea1791f84bb471d5c8d2800d96715, C-085-2 86b7f7e6c875e877653dc6ff13e3850f7afa2743, and C-085-3, whose final SHA is left for the root controller to bind externally after this handoff is committed. Bounded runner failure coverage was added in correction 7cfbb96096d5eba46c37fb5b1885f116aa82ab80 after the C-085-2 review.

Implementation authorship is native Luna Max (OpenAI; reasoning effort max), lifecycle task ushso-pr085-ci-attestation-20260910, actor luna-max. Root owns independent review, final exact-head binding, integration, publication, and any release gate.

## Historical proof

The original WP0 subject remains 0098ee424bc58120f48167c580b7db19b556d0aee42929d1da56664f78993cb5. The exact historical approval, evidence, and approved receipt are pinned in verification/research-program/ci-attestation/historical-wp0-v1.4-pins.json and checked by the new verifier:

- verification/wp0/v1.4.0/approvals/approval.json - d1636ed70d3cff146666a54ea5f9e493e94386649d827c1a424504c244759c05;
- verification/wp0/v1.4.0/approvals/evidence.txt - 1aed5b57042a3a3609666b7678d6d9e6d17d607850dce4ecc90b99320b25ea42;
- verification/wp0/v1.4.0/receipts/approved.json - 15b79d25a52487597236c545b4f9e27be05203850b6e5076b671d6104390a5b8.

The bytes are validated in memory and never rewritten. The historical approval is scoped to its original subject and is not transferred to the current candidate.

## Current technical draft

The final read-only replay is verification/research-program/ci-attestation/current-wp0-replay.json (SHA-256 2d801361c7658b96aadb7421866653373b04b9c5ba979b92781d6b21b326147b). It reports current subject 9539bcc84ab68ec049f7a3a5141a0c91c33c910c5ffd45ead336aea1f7d3c5ab, technical status PASS, status pending_authorized_review, approval null, release_gate_pass false, release_ready false, and production_eligibility false. The implementation inventory contains 543 files and includes scripts/verify-wp0-attestation.mjs.

The direct successor --validate and --issue paths remain unchanged. No approval or receipt was issued.

## Runner behavior

scripts/run-contract-suites.mjs routes only the exact descriptor (alias wp0, path verification/wp0/v1.4.0, version 1.4.0, validate node tools/verify.mjs --validate) through the current attestation verifier. WP0's test stage and all other packages/scripts remain on their existing strict subprocess path. The default verifier path is pinned to scripts/verify-wp0-attestation.mjs; the explicit alternate path exists only for isolated tests.

The bounded subprocess replay passed all 10 focused tests (agentctl cmd-0012-1fd89193, exit 0, 44828 ms, stdout SHA 6c6d688f262a93b2839c6a7f33c494059365e9a86d0485d96e0d299a130b1279). It observed a future WP0 v1.5.0 test count of 1 followed by validation exit 17 and result.ok false; a current-route child exit 23 with result.ok false; and a real empty node --test summary with count 0 rejected by the runner. Temporary fixture roots were under /mnt/d/tmp/plumbob and were removed.

## Validation evidence

The completed-candidate full command was agentctl cmd-0014-9cb38845, 2026-09-11T00:45:20.258Z to 2026-09-11T00:51:17.709Z, duration 357452 ms, exit 1. It retained the unchanged verification/testing/ci/v1.3.0:validate SUCCESSOR_APPROVAL_STALE_SUBJECT failure. The stdout was 190806 bytes, capped to 40000 bytes by the agentctl output limit, with original SHA b7896acd2d8a4a742309065ab91cf622b99b593bfcdd75010b500a4c53f295ba; stderr SHA aa3062d69e007a86131cf18286c300475d55ac60721cc1ee0cc834bbafff6ae4. Build/dry-run is not part of the root npm test chain and remains a root-owned release-gate concern.

The committed prior CI metadata for run 34541539731 is verification/research-program/bootstrap/ci-failure-487f06a.json (SHA 95a3a3f84078a4200142d0b912f31c799bc9f15c7335f67595c79b3dacbbf5bb). The controller additionally reports run 34544925837 at head 61ca92638d1aa87573f4d55be0f5c896f4b0818e failing the same WP0 stale-subject gate; its failed-log SHA is 91c573054a4337df19f834aa9f64c449bafab862a2415fcdc3721404fd170f4c. That latest log was not copied or independently replayed here.

All command attempts, including the initial sandbox EPERM boundary, the corrected scratch fixture, and both full-test failures, are retained by command ID and stream hash in verification/research-program/ci-attestation/command-receipts.json. The complete root test chain string remains byte-bound to package.json SHA 25874c7d9464210794bd7a1467b117ef5fc71808fdf5e34726ea65181744561c. WP0 verify.mjs SHA fe6b6937e8c0abd22cfecd44e1483620ce6cf4585de01e9edf0d6d97bfcb99ec and successor helper SHA 233d1008a823bbde17b1e0e415e34e630be133f2cd7d83040407e7e56ac5356c are unchanged from base.

## Handoff and release boundary

verification/research-program/pr-085/evidence-index.json binds the candidate, source hashes, historical pins, command receipts, and current replay. The final C3 commit cannot embed its own SHA; the root controller must bind the resulting exact head/tree and rerun independent checks against that tree.

PR-082 must obtain current-subject successor authorization and independent release qualification. A development technical pass, the historical approval, or this handoff cannot satisfy that requirement. PR-003 and PR-004 interfaces remain separate. Every R01-R16 predicate remains unaccepted; this work records CI and attestation evidence only.
