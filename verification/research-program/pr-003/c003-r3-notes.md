# PR-003 C-003-2-R3 / C-003-3-R3 — remaining-defect correction evidence

This is a separately scoped Grok Co-Engineer correction from exact parent
`5115170093512b06b21c01725bb982e457797efe` (tree
`24fe636b0370e2e7b9c166d6f1c6bed520ed033e`). It addresses the two remaining
independently reproduced packet-contract defects from the R2 review. It does
not claim independent or scientific acceptance.

## Authorship

- Initial PR-003 implementation was native DeepSeek (`C-003-1` / `C-003-2` /
  `C-003-3`).
- The earlier Grok partial `ushso-pr003-grok-corrections-20260910` failed with
  no commit. Its snapshot, terminal receipt and retained patch remain
  historical evidence and are not completed Grok work.
- Luna completed the R1 recovery. Historical R1 receipts and
  `c003-r1-evidence-index.json` retain the producer self-label
  `gpt-5.6-luna-max/high`. Those records are Luna's work, not completed Grok
  work.
- The R2 correction is Grok work on the reviewed composed candidate.
- This R3 correction is Grok work (`execution.provider: grok`,
  `execution.model: grok-4`, assignment `grok-r3-contract`) on the
  independently reviewed R2 result. It is not a replay of R1 or of the failed
  2026-09-10 Grok task.

## Historical preservation

Every existing command receipt and evidence-index JSON at `5115170` (38 files)
is preserved byte-for-byte, including the R2 index and its old artifact
hashes. Those indexes remain explicitly historical and are not presented as
fresh checks. This directory adds an additive R3 index and new actual command
receipts.

## Task binding authority

The concrete per-PR task binding is
`verification/research-program/pr-003/task-binding.json`. It is established by
the Co-Engineer dispatch packet `ushso-pr003-grok-r3-20260911` (assignment
`grok-r3-contract`) together with the independent R2 review receipt SHA-256
`91924040dd21957d55eab626d19abbfb86b9243b56b6c4caa12635314aae4681` and the
controller reproductions
`c6503896a31cc45732c19003b87f84965ed3af661702a9f9ea18b6ce7a671a2e` (null-item)
and `d5be04adbdb2c2cea16b05bea232bd21115a60d9cf2eccdd99e490804ff279b8`
(wildcard ownership). The producer-written binding file does not authenticate
itself and does not replace controller dispatch review. Local task-binding
consistency does not authenticate the producer. Historical fixture packets
remain scoped to `verification/research-program/pr-003/fixtures/task-binding.json`.

## Boundary

`head_sha` remains null with the typed `head-sha-pending-controller-commit`
claim. Root will externally bind the final commit/tree. Full integrated
`npm test` / build / Cloudflare hosted CI currently needs a separate PR-085
CI inventory correction and is not attempted here.
