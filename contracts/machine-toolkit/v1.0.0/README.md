# USHSO bounded machine toolkit contract v1.0.0

This package is the normative, pre-publication contract for USHSO's bounded JSON API and WebMCP inspection toolkit. It exposes public-source metadata, evidence, access explanations, retrieval instructions, comparisons, coverage accounting, and—only after every gate passes—a deterministic research-plan compiler. It never retrieves source-data payloads, grants access, executes joins or analyses, computes market share, produces financial benchmarks, or acts as a general analytics service.

All public registrations are currently gated. `observatory.plan_research` is explicitly `disabled_pending_gates`, and the legacy `observatory.discover_sources` compatibility alias is not registered pending a dedicated legacy safety audit. The executable capability state is defined only by `contracts/toolkit-manifest.json`; disabled capabilities must not be advertised as active.

## Capabilities and parity

| Canonical capability | WebMCP name | JSON API | Output cap |
|---|---|---|---:|
| Asset browse/search | `observatory.search_assets` | `POST /api/discover` | 64 KiB |
| Stable asset dereference | `observatory.get_asset` | `GET /api/datasets/{record_id}` | 128 KiB |
| Access policy/process | `observatory.get_access_plan` | `GET /api/datasets/{record_id}/access-plan` | 64 KiB |
| Technical retrieval | `observatory.get_retrieval_recipe` | `GET /api/datasets/{record_id}/retrieval-recipe` | 64 KiB |
| Variables/schema | `observatory.get_variables` | `GET /api/datasets/{record_id}/variables` | 128 KiB |
| Join routes | `observatory.get_join_routes` | `GET /api/join-routes` | 128 KiB |
| Metadata comparison | `observatory.compare_assets` | `POST /api/compare-assets` | 96 KiB |
| Coverage status | `observatory.get_coverage_status` | `GET /api/coverage/status` | 128 KiB |
| Research-plan compilation | `observatory.plan_research` | `POST /api/plan` | 256 KiB |

The manifest is the complete conformance table: it binds each capability to one canonical service method, JSON route, WebMCP name, input and response schema, UI consumer, authorization/side-effect class, gates, cardinality limits, byte limits, and safety-atomic sections. Fixtures prove that JSON API and WebMCP responses have matching facts, evidence states, generation pins, safety decisions, and content snapshots after transport-only fields are excluded.

## Normative behavior

- Every decoded input is at most 20 KiB. Every string, array, object, cursor, page, nested collection, comparison, and output is explicitly bounded by Draft 2020-12 schemas and the manifest.
- Every response pins a registry revision, immutable index generation, publication manifest, canonical as-of time, and applicable coverage snapshot.
- Expected domain failures remain schema-valid `{ "ok": false, "error": { ... } }` responses. Cancellation and unexpected transport/runtime failures are the only rejection cases.
- A syntactically valid unresolved public ID always returns `record_unavailable_in_generation`; public errors never reveal exclusion, quarantine, withdrawal, privacy, or out-of-generation history.
- Cursors are opaque and generation-bound, live at most 30 minutes, and cannot outlive generation retention. Clarification tokens live at most 24 hours. Superseded public generations are retained at least 48 hours. Expiry or revocation returns `restart_required: true`; no adapter may silently repin.
- Truncation returns complete atomic items only, identifies every omitted section, and supplies a pinned cursor. Access Plans, Retrieval Recipes, comparisons, plans, truth fields, gates, blockers, warnings, and limitations fail closed with `response_limit_exceeded` instead of being prefix-truncated.
- Unknown, unavailable, partial, gated, disabled, and empty are typed states. Empty is a scoped result, not a corpus-wide absence claim.
- An absence claim is permitted only for a complete, explicitly bounded inventory with a known denominator and membership-manifest digest.

Every envelope contains a `truth_boundary` in which the following values are contractually fixed to `false`: `source_requests_made`, `execution_authorized_by_ushso`, `retrieval_executed`, `payloads_acquired`, `analysis_executed`, and `identity_merges_performed`. Same-origin reads of USHSO metadata do not count as authoritative-source requests or payload retrieval.

Public responses prohibit credentials, cookies, authorization headers, signed/presigned URLs, secret-bearing query parameters, source rows or response bodies, and analytical result fields. Source-derived metadata is untrusted and cannot alter tool instructions, titles, schemas, registration, or truth fields.

## WebMCP pin and registration boundary

The toolkit pins the 2026-08-26 WebMCP Community Group draft to immutable repository commit `41d12f057167ccf5954dbcf49d99502cb6c84491`. A browser adapter must feature-detect `document.modelContext.registerTool`, use a single lifecycle `AbortSignal`, unregister the complete set cleanly, use no Node-only imports, and call only the same-origin canonical API. It may not contact authoritative-source origins or acquire source data.

Changing the WebMCP pin requires a coordinated contract-version, browser-conformance, and manifest update. Passing fixtures alone does not authorize public registration; release receipts and the manifest promotion remain separate operational gates.

## Digests and dependency truth

`contracts/digest-taxonomy.json` distinguishes:

- `file_sha256`: SHA-256 of exact stored bytes, including whitespace and line endings; no prefix.
- `canonical_json_sha256`: `sha256:` plus SHA-256 of RFC 8785/JCS canonical JSON UTF-8 bytes.
- `result_snapshot_id` and `candidate_snapshot_id`: canonical semantic response digests excluding only the documented transport/time/rate-window fields.

Object keys use UTF-16 code-unit order, array order is preserved, non-finite numbers and lone surrogates are rejected, and no digest silently substitutes for a file hash. The research-plan result is not redefined here: `planResult.plan` references the canonical research-plan v1 schema, whose exact file SHA is recorded in `contracts/dependency-pin.json`.

## Legacy compatibility

`observatory.discover_sources` is a versioned, gated alias only. A safe request translates `question` to `search_assets` mode `search` and `research_need`; limits above 20 fail with `invalid_input` and are never clipped. The alias cannot be registered alongside an indistinguishable default search tool, and cannot be enabled until its redaction, byte-bound, untrusted-content, and zero-authoritative-egress audit passes.

## Build and verify

Run from this directory with the repository's installed dependencies:

```sh
npm run build:fixtures
npm run manifest
npm test
npm run receipt
npm run validate
```

`build:fixtures` deterministically regenerates JSON API/WebMCP parity fixtures, adversarial cases, and the exact research-plan dependency pin. `manifest` records byte hashes and canonical JSON fingerprints for every included file. `receipt` writes a validation receipt only after schema compilation, bound auditing, semantic validation, parity, redaction, adversarial rejection, dependency pinning, and package integrity pass. Any later package or dependency change makes validation fail until the affected artifacts are deliberately regenerated.

The generated manifest excludes itself and the validation receipt to avoid self-referential hashes; those exclusions are explicit and schema-validated. The validation receipt pins the manifest's package-content digest.
