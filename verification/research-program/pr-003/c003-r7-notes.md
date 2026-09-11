# PR-003 C-003-3-R7 — unique cleanup-control evidence

This additive record covers the bounded R7 continuation from prepared input
commit a8cec211a2d93988e53ee2f85c31c2cac470b4eb (tree
2a0d1321a908cbb0832252da12460bfe5aca7219). The functional correction is commit
220912e4ad14bf2098b24c797d2e91b7b7bf75a2 (tree
e25563e1e40a4e6658c58c59573b81afbaa98969). The evidence commit remains pending
until the controller binds its exact final head and tree. Functional R6 remains
d6578daad24a82f1c8ab587c44fbc74b44573b13 (tree
ed9ca3c22a93a46f0cdd39a0f5202a0c3e486c96). R6 dispatch base remains
243a12510eb8ed3c7646d8a4d5d151a46b3cf28a. Functional R5 remains
852c0cfe8eb81bbca34306ab5fd192ab1558a07f (tree
686b8c57095410cd054823dff64342f90ca24de8).

## Correction

The cleanup regression test no longer creates or recursively removes the fixed
path `verification/research-program/pr-003/fixtures/.scratch/unrelated-keep-me`.
It allocates a unique unrelated control with `mkdtemp`, asserts that
`removeOwnedTempDir` refuses that untracked path, removes only the owned child,
and checks that the control sentinel remains. `finally` removes only the newly
created control. No new generalized temp policy or runtime capability was
added. `scripts/research-program/check-handoff.mjs` is unchanged at SHA-256
`45136e123eab6b9b6ac7dc81cc99f81e1db5e458caac2ab9f17f816f8aebe098`.

R6 run `ushso-pr003-grok-r6-20260911` / `grok-r6-portability` was CANCELLED at
its deadline. Its eight receipts, evidence index and interruption note are
preserved byte-for-byte and are not re-presented as a completed R6 run.

## Execution

This is Grok Co-Engineer work (`execution.provider: grok`, dispatch
`execution.model: grok-4`). This interface identifies as Grok 4.6. Prior
R6/R5/R4/DeepSeek/Grok records remain historical and are not credited with the
R7 patch. The managed branch is
`codex/ce-ushso-pr003-grok-r7-2026-grok-r7-finalize-606127415ace-2aec4b10`.
Accepted dependencies remain PR-001 `035465f3f16d15f02467679d96451d4440a36ca8`
and PR-002 `5647e81457b606bb36456e75c48f990ce21e9c6c`.

The focused handoff suite, registered research-program script, schema helper,
PR guidance helper and current handoff checks are recorded in the R7 receipts.
The cleanup test preserved a separately pre-existing controller-style sentinel
at the former fixed path. Historical audit found 71/71 command-receipt/evidence-index
files at a8cec211 byte-identical (62 prior to R6 plus eight R6 receipts and the
R6 index).

This packet remains producer evidence with a typed pending `head_sha: null`.
Independent review, scientific acceptance, publication, merge and deployment
remain outside this continuation. Full root npm test, build and Cloudflare
gates remain separately owned.
