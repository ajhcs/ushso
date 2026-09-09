# USHSO machine-toolkit foundation

This package is the additive WP12 foundation for
`observatory-machine-toolkit.v1.0.0`. It provides one injected canonical service
interface, transport adapters for JSON API and WebMCP, strict runtime input and
safety-boundary validation, semantic snapshots, the frozen tool descriptors,
and lifecycle-aware WebMCP registration.

The v1.2 successor activates exactly eight public read-only inspection
capabilities in `PUBLIC_CAPABILITY_FLAGS`. The browser entry point registers
them when `document.modelContext` exists, and the Worker exposes equivalent
same-origin JSON routes under `/api/machine/v1`. `plan_research` is denied in
code and cannot be enabled by caller configuration.

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

`registerObservatoryToolkitWebMcp` has no activation argument and registers the
fixed eight-inspection-tool public set. It accepts no caller-supplied capability
flags and cannot include the planner. All registrations share one
`AbortSignal`, propagate caller cancellation, and unregister as a set. The web
application supplies self-contained copies of the frozen input schemas so a
browser agent does not need to resolve external JSON Schema references.

The Worker router uses the same reviewed public flags and rejects caller
activation fields. It provides bounded JSON input handling, exact methods,
same-origin enforcement, safe errors, and request cancellation. The static
service reads only the pinned catalog already loaded by the Worker; tool
invocation cannot perform source acquisition or payload retrieval.

## Legacy decision

`observatory.discover_sources` remains untouched for v1 compatibility. The WP12
audit found that its current descriptor permits limits above the v1 toolkit cap
and does not publish complete nested collection/byte bounds or the new envelope.
The legacy alias therefore remains unregistered. The safe
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

These commands use mocks and pinned fixtures. Native browser discovery and
invocation must additionally be demonstrated in a WebMCP-capable secure browser
against an isolated deployment before production promotion.
