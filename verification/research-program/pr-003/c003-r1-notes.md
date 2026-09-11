# PR-003 C-003-1-R1 / C-003-2-R1 — integrity recovery evidence

This is a Luna Max recovery from exact parent `f62ce35481cc572e9aad054049c700aac6378f58` (tree `548d34311909ab3c4bb36c126896c7787d9b3dab`). It binds the corrected PR-003 handoff schema/validator to explicit command outcomes, RFC3339 UTC timestamps, on-disk local sources and artifacts, realpath containment, per-PR task/Git roots, and a typed precommit pending head. It does not claim independent or scientific acceptance.

## Authorship and retained failure

The earlier Grok run `ushso-pr003-grok-corrections-20260910` ended normally at `2026-09-10T22:50:15.214Z` with generic `RUNTIME` / `ACP worker failed`, no commit, and terminal cleanup `inactive_empty` / `unlocked`. Its immutable snapshot is `pr003-grok-partial-review/snapshot.json` (SHA-256 `8470e4f3629131525e892bdac65a2b9dfdce84d0fa4891fbf46197d3d976d098`), terminal receipt `terminal-summary.json` (SHA-256 `418001e75d1b1778215b9f7bd71cc63b20f934af61a6492d52d2a800f22397db`), and retained patch SHA-256 `67dbf6bb4302bbc073bdfcb56646b5e1d50b341855aa560e46db2e4b76d86e99`. Luna reviewed those four uncommitted file edits and reworked useful contract ideas; no Grok worktree was resumed or edited, and no Grok success or commit is implied.

Adopted ideas were explicit expected/observed command outcomes, local versus external source locations, unique nested event-source IDs and resolved path checks. They were reworked to keep the schema pinned to the validator module's authoritative directory, resolve packet/evidence/task/ledger/Git paths from the caller's `repoRoot`, deduplicate the same real task-binding file, reject cross-root symlinks, require concrete task base ancestry, and preserve a non-circular null head only for typed precommit evidence. Unreviewed partial changes were not copied wholesale; no production/runtime/config dependency was added.

## Historical preservation

Original PR-003 commits remain immutable: C-003-1 `601072e92a76623438313cdaa20f8bc1c66e929c` (tree `5573db5ac0cac47ca3880e0d71c68175115e4be9`), C-003-2 `93793bf8266c4977e8e108c456f269a8fec086b6` (tree `7ad1f62a4087ef6aa8a1024493d6806ad9312ad0`), and C-003-3 / correction parent `f62ce35481cc572e9aad054049c700aac6378f58` (tree `548d34311909ab3c4bb36c126896c7787d9b3dab`). Historical command receipts and evidence indexes are not rewritten. The explicit 17-file Git-byte audit at f62 passed; rows and hashes are in the JSON index.

The f62 controller review (`review.json`, SHA-256 `376503606459e12e99ac7aed625d97c2f1802429d8604dd97cb37db6b56191ff`), host addendum (`host-check-addendum.json`, SHA-256 `e6b676817dc51d4be46eee0581dec59fb7e98253109af1e70e04225d5ff73fbb`) and independent C1/C2 review (`independent-review-receipt.json`, SHA-256 `6973872dd5b818568019d8376c96b13b3b4d81d9acb641c5edfc92b896d8e482`) remain external review inputs. Historical receipts retain their earlier timestamps and the old unbound-ledger observation; current handoff rows rebind current files without changing those bytes.

## Immutable historical inputs

The current handoff marks the mutable controller inputs `EXECUTION.md`, the
PR-003 packet, the body/template documents and `docs/research-program/execution-ledger.json` as external Git snapshots at exact commit
`f62ce35481cc572e9aad054049c700aac6378f58`, with the commit/path SHA-256
recorded in each source row. The corrected checker verifies those bytes with
`git show` from the configured repository root, so later plan/ledger edits
do not masquerade as the historical inputs. Correction code, fixtures,
receipts, notes and the evidence index remain current local artifacts and are
checked against their on-disk bytes. The five snapshot rows are repeated in
the JSON evidence index.

## Current producer checks

The final correction checks were run after commit `59ae43c592bde7d6e7a9298351593c6f5b642a7f` (tree `b82584ea64ecdee21e610b970583f8cfc56b0679`) using the active Luna writer and `agentctl`. The sealed successful replay set covers schema contract (cmd-0017-4bcc81b2), 23 focused validator tests (cmd-0018-febf1485), corrected portable path probes (cmd-0020-eb5e19c5), the explicit 17-file historical hash audit (cmd-0021-2c01e4e8), and current default handoff verification (cmd-0022-8d928b2c); all five exited 0. After receipt/index sealing, the fully sealed handoff was rechecked by cmd-0023-0aebb900 (exit 0). The first sealed portable probe (cmd-0019-d4930fec) exited 1 because one intended escape remained inside the root; that failed attempt is retained, excluded from acceptance, and followed by the successful corrected retry. Receipt IDs, timings, actual exits, output hashes and bytes are recorded in the JSON index and as additive command receipts under `command-receipts/`.

The earlier pinned npm setup used `/mnt/d/tmp/plumbob/ushso-research-program-20260910/tooling/node_modules/.bin/npm ci`, receipt `cmd-0001-a27231f8`, exit 0 at `2026-09-10T23:10:53.077Z`–`23:10:57.520Z`; lockfile content was unchanged. A baseline focused run before fixture completion failed with agentctl command `cmd-0002-cf9b1a08`, exit 1 at `2026-09-10T23:13:58.961Z`–`23:13:59.445Z`; its retained stdout SHA-256 was `f035450d…` and output was 5517 bytes. That failure is setup evidence, not a producer success claim. One initial interactive portable probe was rejected by Bash history expansion before agentctl (`bash: !accepted.ok: event not found`) and was rerun with history expansion disabled; it is not represented as a provider/test result.

## Boundary

`head_sha` remains null with the typed `head-sha-pending-controller-commit` claim. The correction commits have null SHA fields in the precommit packet by design; a controller-authored external receipt must bind the exact final commit/tree after commit. The full root npm/build/Cloudflare gates, inventory work and independent review remain outside this bounded correction.
