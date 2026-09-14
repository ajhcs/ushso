# PR-003 C-003-3-R5 — fixture-context isolation evidence

This additive record covers the bounded R5 continuation from reviewed R4 base
commit d1c42eab33e1c21edf805036464f2b64667a489a (tree
d765aa66a6bc360a3c03a86eaf54b6366ccb2be1). The functional correction is commit
852c0cfe8eb81bbca34306ab5fd192ab1558a07f (tree
686b8c57095410cd054823dff64342f90ca24de8). The evidence commit remains pending
until the controller binds its exact final head and tree.

## Correction

Historical fixture packets no longer inherit the live controller execution
ledger. Positive, expected-negative, unavailable, malformed-packet, immutable
Git-snapshot and CLI fixture checks run against an explicit in-repo ignored
`.context` root that carries a controlled ledger matching the historical
fixture binding `f62ce35481cc572e9aad054049c700aac6378f58`. Ordinary Git lookup
from that nested directory still resolves the containing repository. Default
`checkHandoff` / CLI (no `--context`) still reads
`docs/research-program/execution-ledger.json` and still reports
`binding_conflict` when a task binding disagrees with that live ledger.

The observed combined-head mismatch is reproduced as test data from root
`0c29fdb984c7bb4c101650e4bae86c716048c237` (fixture base f62ce354 vs live
ledger base 0b28d036). A different plausible ledger base
`e5c44249b9d2448df2e4b6d466077658e42a009d` also rejects with
`binding_conflict`. The matching controlled context remains accepted. The
validator was not weakened, historical receipts were not rewritten, and the
suite is not pinned to the latest moving root base.

## Execution

This is Grok Co-Engineer work (`execution.provider: grok`, dispatch
`execution.model: grok-4`). This interface identifies as Grok 4.6. Prior
R4/DeepSeek/Grok records remain historical and are not credited with the R5
patch. The managed branch is
`codex/ce-ushso-pr003-grok-r5-2026-grok-r5-fixtures-c99b0be1d72f-ffdb9323`.
Accepted dependencies remain PR-001 `035465f3f16d15f02467679d96451d4440a36ca8`
and PR-002 `5647e81457b606bb36456e75c48f990ce21e9c6c`.

The focused handoff suite passed 49/49 tests. The registered research-program
script, schema helper, PR guidance helper and current handoff check also exited
0. Historical audit found 53/53 pre-existing command-receipt/evidence-index
files byte-identical at d1c42ea.

This packet remains producer evidence with a typed pending `head_sha: null`.
Independent review, scientific acceptance, publication, merge and deployment
remain outside this continuation. Full root npm test, build and Cloudflare
gates remain separately owned. WP11 scope review and PR-085 package.json
historical-context correction are outside this assignment.
