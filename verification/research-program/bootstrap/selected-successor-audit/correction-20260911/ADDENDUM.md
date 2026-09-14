# Correction addendum: PR085 selected successor input audit

Correction timestamp: `2026-09-11T03:52:41.740775Z`. This addendum preserves the original audit artifacts unchanged and corrects only the PR003 object identifier and CI transition interpretation.

## Corrected PR003 identity

The original audit recorded `requested_pr003_commit` as `0b28d036f1df4b5248732bc62f68edd79f14d06e`. That value has a final hexadecimal `e`; it was a one-character transcription typo. The failed lookup was for that mistyped identifier, so the earlier statement that the requested object was absent is withdrawn. The correct requested R3 commit is `0b28d036f1df4b5248732bc62f68edd79f14d06f`, tree `6e2de2232e2aa0f19055751d70e5a904a38216f9`, parent `56ec38e3bb4c1af0e558a76c996816a7a604132f`, and subject `docs(research): record PR003 R3 evidence and provenance`. It is present in the shared Git store and `git merge-base --is-ancestor 0b28d036f1df4b5248732bc62f68edd79f14d06f d1c42eab33e1c21edf805036464f2b64667a489a` exited `0`.

The requested commit and final PR003 component `d1c42eab33e1c21edf805036464f2b64667a489a` are byte-identical for both requested inputs:

| Path | `0b28d036f1df4b5248732bc62f68edd79f14d06f` | `d1c42eab33e1c21edf805036464f2b64667a489a` | Result |
| --- | --- | --- | --- |
| `package.json` | 3666 bytes, `b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e` | 3666 bytes, `b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e` | byte-identical |
| `tests/contract-package-inventory.test.mjs` | 7842 bytes, `5ab3deb8457c1a66fc313011bb0d96039c90f5ae35e1e08a9d34c9ab24d6c24b` | 7842 bytes, `5ab3deb8457c1a66fc313011bb0d96039c90f5ae35e1e08a9d34c9ab24d6c24b` | byte-identical |

## Corrected CI v1.4 interpretation

The CI v1.4 source at PR085 9c and final 4f9 supports two complete states for the reviewed paths:

- The complete original historical pair is accepted when `package.json` is 3555 bytes / `25874c7d9464210794bd7a1467b117ef5fc71808fdf5e34726ea65181744561c` and `tests/contract-package-inventory.test.mjs` is 7809 bytes / `2bdf766d6c69875160330d8bdf44fbd8d21bbfec43a9b7671c9d233e3ddc4bfa`. This is the complete pair present at 9c, so the earlier wording that 9c “does not satisfy current transition” must not be read as a CI validation failure.
- The complete reviewed PR003 pair is accepted when the two exact current bytes are 3666 / `b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e` and 7842 / `5ab3deb8457c1a66fc313011bb0d96039c90f5ae35e1e08a9d34c9ab24d6c24b`. The corrected `0b28d036f1df4b5248732bc62f68edd79f14d06f` and final `d1c42eab33e1c21edf805036464f2b64667a489a` objects both contain that pair.
- Either mixed pair is rejected by the source guard `CI_CURRENT_REVIEWED_PR003_PARTIAL_TRANSITION`: both paths must resolve to the same state. This correction did not execute the verifier; the result is a source-level disposition.

In both accepted states, the current v1.4 draft remains `technical_status: PASS`, `status: pending_authorized_review`, with no current approval, release qualification, or production eligibility. Historical proof remains subject-bound and is not repinned or overwritten. The controller separately reports successful CI execution for the complete original pair on 4f9 and the complete reviewed pair on composed candidate 062a; this correction does not rerun those checks.

## Preserved findings and artifacts

The WP0, WP11, program-ledger, WP14, WP8, manifest and package-identity findings from the original audit are unchanged. Original files remain byte-identical; their exact hashes and the corrected source/transition evidence are recorded in `correction-receipt.json` and `corrected-pr003-transition.json`.

No repository, network, provider, package, approval or production action was performed. No broad test or CI execution was performed for this correction.
