# PR-003 C-003-3-R6 — portable fixture storage evidence

This additive record covers the bounded R6 continuation from reviewed R5 base
commit 243a12510eb8ed3c7646d8a4d5d151a46b3cf28a (tree
e55c6413693acb39661c1457fcfee109603b6cc9). The functional correction is commit
d6578daad24a82f1c8ab587c44fbc74b44573b13 (tree
ed9ca3c22a93a46f0cdd39a0f5202a0c3e486c96). The evidence commit remains pending
until the controller binds its exact final head and tree. Functional R5 remains
852c0cfe8eb81bbca34306ab5fd192ab1558a07f (tree
686b8c57095410cd054823dff64342f90ca24de8).

## Correction

Fixture temporary storage no longer requires an explicit absolute TMPDIR.
A valid absolute TMPDIR is still honored. When TMPDIR is absent, a valid
absolute RUNNER_TEMP is used. When both are absent or are literal `/tmp` or
`/home`, tests use an ignored in-repository fixture scratch root. Task-owned
children are created with mkdtemp and removed individually; an existing
unrelated directory is never recursively removed. Bulk development scratch is
not created under literal `/tmp` or `/home`. CI workflow and package scripts
were not changed.

The observed f62ce354 vs 0b28d036 `binding_conflict` no longer `git show`s
non-ancestor `0c29fdb984c7bb4c101650e4bae86c716048c237`. Routine tests load
the committed PR-003 task-row extraction
`verification/research-program/pr-003/fixtures/captured-0c29fdb-pr003-task-row.json`,
which records the original commit, path, git blob, source bytes and SHA-256.
The second plausible base `e5c44249` and the deliberate dependency-conflict
checks remain. `scripts/research-program/check-handoff.mjs` is unchanged at
SHA-256 `45136e123eab6b9b6ac7dc81cc99f81e1db5e458caac2ab9f17f816f8aebe098`.

## Execution

This is Grok Co-Engineer work (`execution.provider: grok`, dispatch
`execution.model: grok-4`). This interface identifies as Grok 4.6. Prior
R5/R4/DeepSeek/Grok records remain historical and are not credited with the
R6 patch. The managed branch is
`codex/ce-ushso-pr003-grok-r6-2026-grok-r6-portability-90a932fb735a-90573407`.
Accepted dependencies remain PR-001 `035465f3f16d15f02467679d96451d4440a36ca8`
and PR-002 `5647e81457b606bb36456e75c48f990ce21e9c6c`.

The focused handoff suite passed 51/51 tests under the configured TMPDIR. The
registered research-program script also passed 51/51 with TMPDIR unset and
RUNNER_TEMP present. The originally failing combined-head command passed with
both TMPDIR and RUNNER_TEMP absent. Schema helper, PR guidance helper and
current handoff checks also exited 0. Historical audit found 62/62
command-receipt/evidence-index files at 243a125 byte-identical (53 pre-R5 plus
eight R5 receipts and its index).

This packet remains producer evidence with a typed pending `head_sha: null`.
Independent review, scientific acceptance, publication, merge and deployment
remain outside this continuation. Full root npm test, build and Cloudflare
gates remain separately owned.
