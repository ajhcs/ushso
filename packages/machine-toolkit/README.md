# USHSO machine-toolkit foundation

This private package is the additive WP12 foundation for
`observatory-machine-toolkit.v1.0.0`. It provides one injected canonical service
interface, transport adapters for JSON API and WebMCP, strict runtime input and
safety-boundary validation, semantic snapshots, the frozen tool descriptors,
and lifecycle-aware WebMCP registration.

It does not activate a public capability. Every value in
`PUBLIC_CAPABILITY_FLAGS` is `false`, the browser successor is not imported by
the application entry point, and the candidate Worker router is not imported by
`worker/index.mjs`. `plan_research` is additionally denied in code and cannot be
enabled by configuration.

## Canonical service boundary

`createMachineToolkit` accepts one object implementing exactly the shared
capability methods used by both transports:

```text
searchAssets       getAsset             getAccessPlan
getRetrievalRecipe getVariables         getJoinRoutes
compareAssets      getCoverageStatus    planResearch
```

Each inspection method receives a cloned, strictly validated contract input and
an optional abort signal. It returns the transport-independent response core:
generation/publication pins, result or structured domain error, evidence,
warnings, paging state, rate-limit state, and the complete all-false truth
boundary. Transport request IDs, response time, adapter name, and the semantic
snapshot digest are added only by the adapter. Expected domain failures are
returned in the common envelope; cancellation and unexpected runtime failures
reject.

The service is an injected in-process boundary. This package contains no
authoritative-source client, `fetch`, storage, credential, analytics, access
workflow, identity mutation, or payload-acquisition code.

## Bounds and fail-closed behavior

- Every decoded input is at most 20,480 bytes and uses a closed, capability-
  specific runtime shape.
- Output sizes match the frozen 64/96/128/256 KiB limits and are measured on
  uncompressed serialized JSON.
- Cardinality is checked against both the frozen maximum and caller page size.
- Source payload fields, analytics, credentials, authorization values, cookies,
  signed locators, secret query parameters, and source-controlled tool fields
  fail closed before serialization.
- Access Plans, Retrieval Recipes, comparisons, planning, truth, and other
  security-critical sections are never prefix-truncated. An adapter-side byte
  overflow returns `response_limit_exceeded` atomically.
- Generation conflicts, unsafe evidence upgrades, unsupported absence claims,
  action booleans, and privacy-revealing errors fail closed.
- A successful reusable response receives the contract's JCS SHA-256 snapshot;
  transport/time/rate-window fields are excluded exactly as frozen.

## Registration and routing

`registerObservatoryToolkitWebMcp` has no activation argument and therefore
registers zero public tools in this candidate. The explicitly named local-
verification helper uses a fixed eight-inspection-tool set, accepts no caller-
supplied capability flags, and cannot include the planner. All enabled
candidate registrations share one `AbortSignal`, propagate caller cancellation,
and unregister as a set.

The additive Worker router similarly defaults to the all-false public manifest
and rejects caller activation fields. Its separately named local-verification
router has the same fixed inspection set and provides bounded JSON streaming, exact methods,
same-origin enforcement, safe errors, and request cancellation without adding a
Worker entry point or binding.

## Legacy decision

`observatory.discover_sources` remains untouched for v1 compatibility. The WP12
audit found that its current descriptor permits limits above the v1 toolkit cap
and does not publish complete nested collection/byte bounds or the new envelope.
The new `versioned_gated_alias` therefore remains unregistered. The safe
translation subset maps `question` to `search_assets.research_need`, defaults to
ten, rejects limits above twenty rather than clipping, and rejects legacy filters
whose canonical meaning has not been reviewed.

## Local verification

```sh
npm test --prefix packages/machine-toolkit
npm test --prefix apps/web -- src/providers/registerObservatoryToolkit.test.ts
npm run typecheck --prefix apps/web
npm test --prefix contracts/machine-toolkit/v1.0.0
npm run verify --prefix packages/machine-toolkit
```

No command performs a live request, deployment, database/R2 operation, or public
registration.
