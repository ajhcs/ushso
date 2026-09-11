# PR-003 C-003-2-R2 / C-003-3-R2 — final-contract correction evidence

This is a separately scoped Grok Co-Engineer correction from exact parent
`bf46d92b0e4fc91457bd3eb78aa1742ae84038f2` (tree
`98e04d100daa94cdf9da5905c15d58a0aae6778d`). The independently reviewed code
was `dc7267bf1c872f1457fa927e2d0403051575f474`; `bf46d92` adds only the
independently accepted test-chain inventory correction. It does not claim
independent or scientific acceptance.

## Authorship

- Initial PR-003 implementation was native DeepSeek (`C-003-1` / `C-003-2` /
  `C-003-3`).
- The earlier Grok partial `ushso-pr003-grok-corrections-20260910` failed with
  no commit. Its snapshot, terminal receipt and retained patch remain
  historical evidence and are not completed Grok work.
- Luna completed the R1 recovery. Historical R1 receipts and
  `c003-r1-evidence-index.json` retain the producer self-label
  `gpt-5.6-luna-max/high`. Root's native dispatch specified `gpt-5.6-luna/max`;
  that self-label is not a serving-model attestation. Those records are Luna's
  work, not completed Grok work.
- This R2 correction is Grok work (`execution.provider: grok`,
  `execution.model: grok-4`) on the reviewed composed candidate. It is not a
  replay of the failed 2026-09-10 Grok task.

## Historical preservation

Every existing command receipt and evidence-index JSON at `bf46d92` is
preserved byte-for-byte. Those R1 indexes remain explicitly historical and are
not presented as fresh checks. This directory adds an additive R2 index and
new actual command receipts.

## Task binding authority

The concrete per-PR task binding is
`verification/research-program/pr-003/task-binding.json`. It is established by
the Co-Engineer dispatch packet `ushso-pr003-grok-final-contract-20260911`
(assignment `grok-final-contract`) together with the independent final-contract
review receipt SHA-256
`99b542280dc18a34c22affb1dcc6a87780db58be7b53c1e30c9cf37dc33470e6`. The
producer-written binding file does not authenticate itself and does not
replace controller dispatch review. Historical fixture packets remain scoped
to `verification/research-program/pr-003/fixtures/task-binding.json`.

## Boundary

`head_sha` remains null with the typed `head-sha-pending-controller-commit`
claim. Root will externally bind the final commit/tree. Full integrated
`npm test` / build / Cloudflare hosted CI currently needs a separate PR-085
CI inventory correction and is not attempted here.
