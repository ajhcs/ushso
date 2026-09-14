# PR010 locator-corrected local collection interfaces (v3)

This v3 retains the earlier collector/replay corrections and fixes the additional P2 incompatibility with the frozen fixture route allowlist. V2 and both independent reviews are preserved. It is **not adopted or dispatched**. The reviewed source remains clean PR009 producer `27d0b0d7c31d8825b91d899dc280cd843af21465`, tree `aef0428057d73645fab00f4d3aecb3418296f79b`. PR010 base and PR009 merge identities remain null here; the controller must bind the actual accepted merge and live ledger separately. Original proposal/review files are preserved.

## Scope and actual collector integration

Retain the eight previously proposed ingestion/CLI/fixture/test files. Add narrowly owned changes to `scripts/research/refresh.mjs` and `tests/research-automation.test.mjs` through [scope-amendment.json](scope-amendment.json). No released connector, WP5, ingestion contract, SQL/grant, root package/lockfile or Worker composition changes are selected.

The actual existing research function becomes:

```js
capture(url, {
  fetchImpl = fetch,
  maxBytes = 2 * 1024 * 1024,
  timeoutMs = 20000,
  clock = () => new Date(),
  locatorPolicy = metadataUrl,
} = {})
```

Its narrowly owned source changes are the optional clock port for every existing `captured_at` timestamp branch, and the paired explicit-fetch locator-policy port below. Retain the original options object to distinguish an explicitly supplied fetch function from destructuring fallback. The function has no recording-time field, so no fictitious `recorded_at` argument/result is added. Preserve its locator allowlist, fetch options, statuses, body/hash checks, timeout cleanup and existing defaults. The separate unchanged R2CaptureProtocol clock supplies its real `recorded_at` field.

The call chain is **runner → local ingestion HTTP adapter → actual research capture → exact-route fetch bridge → unchanged BoundedHttpClient → fixture transport/durable capture ports**. The bridge accepts only the admitted compiled locator and invokes the bounded client once or reloads its verified prior result. It returns the same decoded bytes as a Response to the research function. The adapter consumes the real collector result: URL, decoded byte count/hash, status, MIME semantics and `captured_at` must agree with the strict fetch/capture and request intent before wrapper success may be persisted or returned to the runner. A merely imported, unused or fabricated research result is insufficient.

Use exactly `source_fixture_catalog`, `endpoint_fixture_catalog`, `route_fixture_catalog` and the existing `https://catalog.example.gov/data.json` route. The second request is `https://catalog.example.gov/data.json?cursor=page-2`. The tight descriptor and both requests passed the actual unchanged validator/compiler in the retained 15-check probe. The legacy default `metadataUrl` continues to reject that fixture host; it is not broadened. The internal fixture composition supplies the exact-locator policy and an explicit fixture fetch bridge. Real descriptors stay paused, and no arbitrary locator/policy or real DNS/network port is exposed.

### Locator-policy contract

`locatorPolicy(inputUrl)` returns a canonical string or null synchronously. Defaulting to the unchanged `metadataUrl` preserves all ordinary default behavior. A custom policy requires an **own explicitly supplied callable** `options.fetchImpl`; omitted, undefined, inherited-only or non-callable values yield `blocked_locator` with `LOCATOR_POLICY_REQUIRES_INJECTED_FETCH` before policy/timer/fetch effects. A custom non-callable policy is also blocked. This prevents accidental fallback to global fetch; the selected fixed composition separately proves zero live calls.

For custom policies, require a primitive canonical HTTPS string exactly equal to the input and its URL serialization, with no credentials/fragment. Reject null, truthy nonstrings, URL objects, Promises, throws, rewritten or noncanonical values with a stable custom-policy reason. The adapter runs actual strict descriptor/route compilation first and creates a closure for that one exact locator including cursor. The bridge independently checks the same exact precompiled URL and pins; policy acceptance is never the bridge's only guard. Default calls do not gain these new canonical-input restrictions or fixture hosts.

For typed strict failures, retain the original strict failure and the actual legacy failure; neither can qualify completion. For 304, invoke the real collector with `new Response(null, {status: 304, headers: safeHeaders})` (a null body) and preserve its existing `http_failed`/304 result as a documented limitation. Only the strict verified prior-capture protocol may yield `not_modified`; never relabel the legacy result `captured` or invent a new capture.

`runBoundedUpdate`, refresh's main/provider CLI, and PDF/layout/CMS batch orchestration remain unintegrated. The bounded actual-capture adapter addresses C0102 without claiming those broader collectors, R03/R15 as a whole, or production readiness complete.

## Identity and clocks

Keep the exact existing scheduler parent key and deterministic run ID. Define a separate canonical collection child ID from the descriptor digest, route/scope, selected IDs, capture class, immutable reservation, collector/fixture identities and scheduled slot. Define its connector execution ID through existing `deterministicOpaqueId('run', {kind:'ushso.collection-execution.v1', collectionJobId})`. All connector repository state and strict capture/fetch/checkpoint records use that execution ID; envelopes retain the parent mapping. Two selected-ID subsets under the same scheduler parent must never share a connector run namespace. Select one separate fresh/replayed MemoryRunRepository per child, because its membership and checkpoint maps are keyed by source ID as well as its run/page structures. Child ID and execution ID guard every record and read; only the actual scheduler parent is shared.

The connector still traverses a complete bounded fixture catalog. Before final membership/checkpoint commit, verify every selected record occurs in the verified complete population and record its selected disposition. Do not filter a page chain then call it full source coverage. Extra fixture catalog observations remain visibly unselected.

One logical attempt (1) is supported per child in this bounded lane. Fresh processes resume that unsettled attempt with durable evidence. A single immutable terminal outcome settles it as `complete_fixture`, typed failure or `partial_unresolved`; terminal attempts cannot be reset/retried by this CLI. An unknown transport intent settles partial/unresolved and cannot automatically redeliver. A provably replayable interrupted prefix remains unsettled and displays its resumable partial state.

Persist both `observation_at` and `capture_recorded_at` before fixture delivery. The selected `fixture-logical-clock.v1` derives observation time from the admitted slot and bounded page ordinal, and recording time one millisecond later. Pass observation time to BoundedHttpClient and the research capture clock; pass recording time to R2CaptureProtocol. Persist and reuse the actual values on restart. Also inject the fixture clock into the existing origin governor, whose default is wall time. Its private state is process-local; journaled delivery/byte reservations remain authoritative across restart, including retained charges for unresolved deliveries and zero new delivery charge for verified cached responses. These are synthetic identity clocks, not measurements of live latency or operating bounds.

## Journal and scheduler admission

The disk journal is the local persistence authority. Reused memory stores are deterministic reducers only. Continue using immutable hash-addressed objects, numbered hash-linked records, OS-held `flock`, exclusive temporary installation and file/directory sync before acknowledgement. Bound object sizes, journal count, children, delivery reservations and replay work. A corrupt reference or sequence blocks; temporary files imply no success.

A successful scheduler transaction is **one journal record** containing its ordered allowlisted operations, original arguments and encoded results. Record only scheduler lease, ensure-run/outbox and dispatch-failure transactions; other methods remain unsupported. Buffer operations inside the actual memory transaction, discard failed transactions, and append/fsync only the entire successful transaction before returning to createScheduler. Reconstruct it inside the same underlying transaction boundary on replay.

Any persistence failure after memory mutation poisons the complete adapter. Existing clients, new openDatabase clients, connector/object/reference ports and fixture transport all share the same poison latch. Only cleanup and safe diagnostics remain allowed. This matters because createScheduler catches a failure and opens another client: its error-handler write must also refuse poisoned state. Recovery requires a fresh adapter replaying the committed disk prefix; no in-process reset is allowed.

Admission is a four-record sequence: `child_admitted` → actual scheduler transaction(s) → `child_bound` → `attempt_started`. The first record durably reserves the immutable child specification and exact expected parent ID before scheduling. On restart, reconstruct committed scheduler state and look up that parent/outbox by exact key and identity. A repeated scheduler call may return no due runs because the previous commit advanced its schedule; that is not evidence the parent is absent. Bind the admitted child to the actual replayed parent without reseeding or reserving twice. If only a lease committed, preserve its normal expiry/fence semantics rather than forcing it away.

## Lossless replay and request commits

Use `ushso.local-value.v1`, a strict tagged codec for finite primitives, explicit undefined positions, arrays, sorted own object properties, insertion-ordered Maps and hash-addressed byte references. Reject unsupported prototypes/functions/accessors/tags. Existing beginRun returns an array initially and a Map for an existing run; preserving this distinction and its entries is required. Plain JSON serialization of a Map as `{}` is not replay equality. Store only operation-specific required projections, with bodies/structured fixture metadata in bounded referenced objects. Pin the final semantic import closure, schemas, source/fixture/policy bytes and runtime/lockfile identity.

Persist request intent and both clocks before fixture delivery; persist the bounded response before transport success; persist strict capture/reference/fetch output; then consume the real research result and atomically persist its safe projection with the PR009 receipt before runner success. A cached wrapper outcome replays directly. A response/capture without wrapper outcome must run the actual research function against verified cached bytes and original clocks before filling the missing commit. Never manufacture an earlier successful collector result.

Commit page observations and next-request/cursor together. Commit final membership/checkpoint and all local downstream intent references together only after complete verified enumeration. The existing checkpoint's outbox flag must be backed by these real local intents; it does not imply managed queue delivery or published coverage.

### Bounded bridge cancellation

The frozen bounded client only passes `timeoutMs` to transport. The injected bridge/fixture transport must enforce the minimum selected deadline and incoming legacy AbortSignal, reject pre-aborted calls before delivery, and return a bounded typed outcome even for a deliberately signal-ignoring test Promise. Revoke the request execution token on timeout/cancellation so late completion cannot create/promote captures, return runner success or advance pages/checkpoints. Retain any already-issued indivisible disk operation and durable prefix for reconciliation; unknown delivery remains charged and unresolved. Tests must release a delayed response after the timeout and prove no late state advance, rather than only inspecting `signal.aborted`.

## Required evidence

Retain all 19 original proposed groups and ten earlier corrected groups covering actual collector execution/result consumption and clock branches; process death after real collector success; death after capture-reference commit; two distinct child selections sharing one parent; parent transaction committed before child association; shared poison propagation and transaction rollback; Map/byte-reference round trips; one terminal attempt outcome; and actual collector 304 limitations. Every restart check creates fresh processes and ports on the same journal and retains a real fixture-delivery counter.

Add seven locator/runtime groups: actual frozen route compatibility, paired explicit-fetch/default compatibility, exact canonical locator/cursor rejection, independent bridge guard, governor/restart reservations, bounded cancellation/null-body304, and source-keyed child repository isolation. Run the job-lifecycle suite, targeted existing research-automation/update-cycle tests, affected ingestion tests, final live-ledger handoff checks and exact-candidate gate. These implementation checks remain planned. The separately authorized scratch compatibility probe passed **15/15 existing-module checks** with zero live or fixture deliveries; an initial Node subprocess guard failure before those checks is preserved, and the corrected external identity wrapper verified unchanged HEAD/tree and all 52 pins.

The complete signatures, schemas, algorithms, 36 planned implementation test groups, ownership limits and immutable baseline source references are in [proposal.json](proposal.json) and [source-pins.json](source-pins.json).

The selected fixture descriptor canonical SHA-256 is `688657fa60077bf18d63085f0ae02c6956f8dbd5d1fbc57c034a88db997bad0c` under `ushso-canonical-json.v1`. Its file hash, exact compiler outputs, successful command receipt and initial harness failure are retained under [probe/results.json](probe/results.json). The new locator-policy seam itself has not been implemented or tested.
