# Catalog v1.2.0 staged recovery

This runbook replaces assumption-driven promotion with observed gates. A stage
may advance only when its acceptance evidence passes; a failure is corrected in
the current stage and all affected downstream gates are rerun.

## Stage state

| Stage | Purpose | State | Advancement evidence |
|---|---|---|---|
| 0 | Preserve and characterize the 157-record baseline | PASS | v1.1.0 remains byte-addressable; production is untouched |
| 1 | Enumerate authoritative catalog metadata | PASS | 159 CMS + 1,472 CDC + 1,803 Census = 3,434 records |
| 2 | Define and enforce truthful verification | PASS | 3,434 current metadata observations; zero payload or broader coverage claims |
| 3 | Build a bounded reproducible corpus | PASS | unique IDs, three sub-8-MiB shards, hashes, zero merges |
| 4 | Serve the successor without hiding totals | PASS | on-demand projection; returned/total counts separated; bounded runtime gate |
| 5 | Wire inspection tools | PASS | Chrome discovered exactly eight tools and invoked all eight through native WebMCP |
| 6 | Freeze one exact release candidate | PENDING FINAL RECEIPT | full suite, release audit, dry-run, WP0 receipt, exact commit |
| 7 | Preview, canary, and promote | BLOCKED BY STAGE 6 | isolated hostname, remote preview receipt, explicit production authorization |

## Stage 0 — baseline and fault isolation

The 157 count was not a backend paging result. It was the total size of the
pinned v1.1.0 corpus assembled from six curated slices. That baseline remains
available for rollback and evaluation identity. The recovery work occurs on an
isolated successor branch and does not alter production routes or data.

## Stage 1 — acquisition boundary

The harvester calls only allowlisted HTTPS first-party catalog endpoints. It
uses bounded responses, timeouts, retries, content-type checks, byte limits, and
source-specific complete-enumeration rules. CDC uses its supported `page`
parameter; the previously used `offset` parameter repeated the first page and
could not prove completeness.

Acceptance requires the page counts, response hashes, source membership hashes,
and arithmetic in `live-catalog-receipt.json` to agree. The stage fails closed
on duplicate source-native IDs, incomplete enumeration, unexpected hosts or
media types, oversized bodies, or a count below 1,000.

## Stage 2 — verification semantics

Every published v1.2 record is verified at the exact evidence grain available:
membership in a live first-party catalog response. Verification does not expand
to payload availability, variables, authorization, geography, infrastructure,
or fitness. Those values remain unknown unless independently evidenced.

Acceptance requires `not_live_verified`, `stale`, and `unknown` to be zero for
catalog membership while tests reject any unsupported geographic,
machine-actionability, infrastructure, or absence claim.

## Stage 3 — identity and publication

Source-native identifiers are preserved. Record IDs include the exact native ID
digest, preventing slug collisions without merging similar titles. The corpus
is split into bounded immutable JSONL shards and all files are SHA-256 pinned.
No search-document duplicate is published; the runtime creates its bounded
projection on demand.

## Stage 4 — runtime and user truth

The Worker loads the exact v1.2 shards and verifies manifest counts. Catalog and
search responses distinguish `returned_count` from `total_matches`, so a 200-row
response cannot be mistaken for the corpus size. The Sources page reports the
three exact source slices and explains the narrow verification meaning.

Acceptance requires the runtime gate to stay within its heap, latency, and
response-size budgets while returning the correct generation and 3,434-record
denominator.

## Stage 5 — machine inspection

One canonical service backs both versioned JSON routes and WebMCP callbacks.
Eight read-only inspection tools are active; `plan_research` remains disabled.
All inputs and outputs are bounded and contract-validated. WebMCP registers
self-contained schemas and uses one abort lifecycle. The current
`document.modelContext` location is preferred; the transitional
`navigator.modelContext` location is supported for earlier Chromium builds.
Invocation performs no source network or payload operation.

Automated acceptance covers registration, routing, schema parity, cancellation,
strict response safety, and one safe response from every tool. Native Chrome
149 then discovered exactly eight tools through its transitional
`navigator.modelContext` surface and successfully invoked all eight against a
secure local Worker preview. Every input schema was self-contained, the planner
was absent, and every response preserved all six false execution-boundary flags.
The machine-readable evidence is `native-webmcp-receipt.json`.

## Stage 6 — exact candidate

After all edits stop, rebuild generated artifacts, create the WP0 successor
receipt, and run every listed gate on one exact tree. Commit that tree once and
record its commit and tree IDs. Any subsequent edit invalidates Stage 6 and
requires new receipts.

## Stage 7 — controlled promotion

Upload the exact Stage 6 commit to a distinct preview hostname without
production routes. Exercise human pages, static hashes, health/contract routes,
catalog counts, representative searches, every machine route, malformed and
oversized requests, and native WebMCP discovery/invocation. Promote only through
an explicitly authorized canary. Roll back on any count, hash, latency, memory,
safety, tool, or error-contract regression.

The isolated upload uses `wrangler.staging.jsonc`, whose distinct Worker name is
`ushso-catalog-recovery-v12` and which intentionally contains no custom routes.
The production `wrangler.jsonc` and `npm run cf:deploy` remain outside this
stage unless production promotion is explicitly authorized.

## Reproduction

```sh
npm run harvest:catalog
npm run test:catalog
npm run verify:catalog-runtime
npm run verify:webmcp-native -- --receipt
npm test --prefix packages/connectors
npm test --prefix packages/machine-toolkit
npm test --prefix verification/wp12/v1.0.0
npm test --prefix verification/wp12/v1.1.0
npm run typecheck --prefix apps/web
npm test --prefix apps/web
npm run build --prefix apps/web
npm run release:audit
npx wrangler deploy --dry-run
```

`harvest:catalog` is the only command above that contacts authoritative source
catalogs. The native WebMCP check requires a compatible Chrome debugging target
at `http://127.0.0.1:8798` and a secure local Worker preview at
`http://127.0.0.1:8799`; either URL can be overridden with
`USHSO_CHROME_DEBUGGER_ORIGIN` or `USHSO_WEBMCP_PAGE_URL`. Preview upload and
production promotion are deliberately not part of the local gate.
