# WP12 machine-toolkit foundation verification

This directory receipts the additive, non-public WP12 foundation requested for
the current implementation phase. The implementation is a protected candidate,
not an activation receipt.

Local fixture and local integration checks pass for the canonical service
interface, frozen JSON/WebMCP parity, all nine input limits, all eight inspection
output/cardinality/redaction boundaries, hard-disabled planner behavior,
lifecycle abort/unregister, browser feature detection, same-origin Worker
routing, prompt injection containment, and zero authoritative-source actions.

Public activation, live/canary traffic, Access-protected production-like staging,
UI/API entry-point wiring, `/agents`, `llms.txt`, and public capability
documentation remain pending the prerequisite WP10B/release gates and explicit
cutover authority. The public flags remain all false, the successor browser file
is not imported by `main.tsx`, and the Worker router is not imported by
`worker/index.mjs`.

`AUTH-12` remains a hard dependency for planner implementation/activation.
`AUTH-06` is required before an Access-protected production internal candidate,
and `AUTH-07` is required before any public deployment or gradual cutover. This
receipt does not mark WP12 accepted.
`AUTH-13`, `AUTH-14`, and `AUTH-15` additionally remain required for the
retrieval-, identity-, and coverage-gated capabilities respectively.

Run:

```sh
npm test --prefix packages/machine-toolkit
npm test --prefix apps/web -- src/providers/registerObservatoryToolkit.test.ts
npm run typecheck --prefix apps/web
npm test --prefix contracts/machine-toolkit/v1.0.0
npm run verify --prefix packages/machine-toolkit
```
