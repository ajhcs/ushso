# Co-Engineer 3.4.2 Grok deadline-extension diagnosis

Scope was limited to the installed Co-Engineer 3.4.2 deadline, extension, worker timer, ACP `end_turn`, and task-wait paths, plus the two named public receipts. No provider process, active C3 task state, prompt, secret, broad task history, repository file, code, or configuration was read or changed.

## Evidence

Receipt hashes:

- `verification/research-program/bootstrap/pr002-c2-c3-deadline-extension.json`: SHA-256 `6e40880f2aa1e4697086ab5bb93ce1e601ae43fc9cfb078199793f23adc58c55`
- `verification/research-program/bootstrap/pr002-grok-c2-partial-completion.json`: SHA-256 `d63b93c51ea78e2b132d24ed8b4aca30d64915a0ade0278ab9ec1f02c8661fa8`

The receipts record: start `18:54:26.245Z`; original deadline `19:12:25.771Z`; extension at `19:06:32.268Z`; returned deadline `19:36:32.268Z`; finish `19:12:27.828Z`; interface status `completed`; `error_code: ok`; provider terminal stage `end_turn`; cleanup `normal / inactive_empty / unlocked`. The extension was 353.503 seconds before the original deadline. Finish was 2.057 seconds after the original deadline and 1,444.440 seconds before the extended deadline.

The installed source files were hashed for provenance:

- `mcp/v3/acp-worker.mjs`: `38eec6f9322b2afb0c1beb848399b33c190b9ac3d8176adb0584178556c9dcfd`
- `mcp/v3/deadline.mjs`: `32ad2aa23647d28c54e071af0b946e4f9979d20597350858c9e17b2cb98806ea`
- `mcp/v3/supervisor.mjs`: `65f0a7fe856479ff0c6412972437ba596a5bf3ce6347914c1bfea78a60506ea2`
- `mcp/v3/task-store.mjs`: `dd5744ab3ad9784d059e6c51dba4a062fa5114ed99a209df97860cf763394376`
- `assets/acpx-runtime.mjs`: `069bdae5541dd53876dfa806c2c3dbb2bd9bdbc1d3763fdbcd1f0e5e1efaf3b6`

## What the extension changes

The supported control path is `inspectTask` with `extend_expected_duration_ms` and `extend_reason` (`mcp/v3/supervisor.mjs:2673-2683`). It calls `extendTaskDeadline`, which validates that the task is non-terminal, the old deadline has not expired, and the new deadline is strictly later; it then persists the new expected duration, timeout, deadline, and immutable extension record and appends a `deadline_extended` event (`supervisor.mjs:1044-1055`; `deadline.mjs:100-137`). The receipt's returned deadline is correctly calculated from the extension time.

The worker has a separate deadline watch. It reads the current task deadline and arms a timer, and watches the task directory so a task-record update causes a re-read and re-arm (`acp-worker.mjs:462-487`). `updateTask` atomically renames the updated task record (`task-store.mjs:274-297`), so the extension is designed to update this outer worker watchdog when the filesystem event is delivered. Controller waiters also re-read and replace their deadline after wakeups (`task-store.mjs:717-862`).

## Limitation for an already-running Grok ACP turn

`runAcpTask` calculates `timeoutMs` once from the task's current deadline (`acp-worker.mjs:1682-1686`), passes that value into `makeRuntime` (`acp-worker.mjs:1595-1611,1692-1694`), and passes the same value to `runtime.startTurn` (`acp-worker.mjs:1737-1744`). The worker's outer watch can abort the turn (`acp-worker.mjs:1699-1702`), but no extension callback changes this captured value.

The bundled ACPX runtime has no task-record/deadline read in the turn path. Its generated source passes `input.timeoutMs` into the manager (`assets/acpx-runtime.mjs:91`), the manager supplies `task.input.timeoutMs` to `runPromptTurn` (`assets/acpx-runtime.mjs:90`), and `runPromptTurn` calls `withTimeout` with that value (`assets/acpx-runtime.mjs:89`). `withTimeout` creates one `setTimeout` for the supplied duration (`assets/acpx-runtime.mjs:65`). The inspected runtime exposes no operation that retroactively replaces that per-prompt timer. Thus the extension is supported for the persisted deadline, controller waits, and worker watchdog, while the already-created ACP prompt timer remains governed by the original value in this source path.

`runPromptTurn` also converts a `TimeoutError` into `{stopReason: "end_turn", source: "session"}` when an agent reply is already present (`assets/acpx-runtime.mjs:89`); the manager propagates only `stopReason` (`assets/acpx-runtime.mjs:90`). Therefore a public `end_turn` does not identify whether the provider naturally returned `end_turn` or the runtime's timeout fallback supplied it.

## Diagnosis and uncertainty

The source supports a real deadline-extension operation, but it does not establish that the operation updates an already-running Grok ACP prompt's internal timer. The prior receipt's completion just after the original deadline, normal cleanup, `error_code: ok`, and `end_turn` are consistent with a fixed ACP prompt timer or with a natural provider completion; they do not prove timeout expiry, failed extension propagation, or authentication failure. The exact cause of that prior completion remains unresolved without a permitted authoritative runtime event/stop-source record. No active run was inspected or affected.

## Read-only method record

Commands used were targeted `nl -ba`/`rg` source reads and `sha256sum` over the two named receipts and five named source files; a timestamp-difference calculation was run from the receipt values. No command failed, and no repository or runtime mutation was performed.

## Control and host references

The applicable control skill is `/home/plumbob/.codex/plugins/cache/coengineer-plumbob-release/codex-co-engineer/3.4.2/skills/control-codex-co-engineer-agents/SKILL.md:81-87,105-126`, which requires pre-expiry strictly-later extensions and says disconnecting a waiter does not stop provider work. The relevant host note is `/home/plumbob/.codex/memories/plumbob-server/agent-harnesses.md:5-19`; it records that the contemporaneous generic runtime failure did not establish authentication or a more specific cause and that provider completion does not establish acceptance. `/home/plumbob/.codex/memories/plumbob-server/codex-stock-setup.md:1-3,15` supplied the stock-runtime/no-unsolicited-tuning context.
