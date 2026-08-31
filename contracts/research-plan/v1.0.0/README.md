# USHSO research-plan contract v1.0.0

This immutable package defines the canonical, deterministic handoff produced by
the USHSO research-plan compiler. A plan recommends exact metadata objects,
explains compatibility and access, and compiles instructions that a researcher
may execute elsewhere. It never retrieves source payloads, grants access,
changes identity, executes an operation, or returns analytical results.

## Contract surfaces

- `research-plan-request.schema.json` bounds the public planning request.
- `normalized-request.schema.json` pins the deterministic, privacy-minimized
  interpretation used by the planner.
- `clarification.schema.json` defines stable questions, answers, and signed
  token claims containing hashes and generation pins—not question text or user
  identifiers.
- `research-plan.schema.json` requires every section in plan §14.1, exact
  Asset/Release/Distribution/AccessRoute/Source identifiers, operation and
  acquisition DAGs, evidence, status reasons, and the common const-false truth
  boundary.
- `planner-response.schema.json` keeps request IDs, response time, and the
  opaque clarification token outside the canonical plan digest.
- `claim-manifest.json` freezes auditable and critical JSON-Pointer claims.
- `digest-taxonomy.json` removes ambiguity between raw-file, canonical-manifest,
  normalized-request, question-set, and canonical-plan digests.

The claim manifest also pins a canonical inventory of every property in the
truth-bearing plan schemas. Adding a field changes that digest and blocks
validation until the versioned claim manifest is deliberately updated.

All JSON objects are closed with `additionalProperties: false`; arrays and
strings are bounded. JSON Schema establishes shape. `tools/semantics.mjs` then
enforces status precedence, exact selection, evidence admissibility/staleness,
coverage intersection and calendar kind, access/human gates, identity time,
join strength, transformation meaning, DAG acyclicity, claim coverage, and the
metadata-only boundary.

## Plan identity and transport

`plan_id` is `sha256:` plus the lowercase SHA-256 of canonical JSON after
removing `/plan_id`. Transport-only `/request_id`, `/response_generated_at`, and
`/clarification_token` live in the response envelope and never enter the
canonical plan. Repeating the same normalized request, publication pins, source
manifests, candidate snapshot, claim manifest, and planner fingerprint therefore
produces the same plan payload and identifier.

The package manifest hashes every immutable input artifact as raw file bytes.
It excludes only itself and the validation receipt to avoid a digest cycle; the
receipt pins the manifest's canonical digest, and the validator proves that no
other package path is omitted.

## Status precedence

The semantic validator derives status in this exact order:

1. `unsupported`
2. `clarification_required`
3. `incomplete`
4. `ready_with_constraints`
5. `ready`

Templates cannot override the result. Unsupported and clarification plans may
not contain a confident recommendation. Ready plans require exact executable
metadata IDs, a complete non-executed acquisition DAG, admissible current
evidence, and no unresolved essential operation.

## Clarification privacy

Clarification is stateless. Signed claims bind the contract and key version,
normalized-request hash, question-set hash, expected generation, issue time, and
expiry (maximum 24 hours). Verification checks signature, allowed key state,
expiry, request/question hashes, and generation. The fixtures cover tampering,
expiry, verify-only key rotation, and stale generation. Neither claims nor token
fixtures contain raw questions or user identifiers.

## Commands

```text
npm test --prefix contracts/research-plan/v1.0.0
npm run validate --prefix contracts/research-plan/v1.0.0
npm run manifest --prefix contracts/research-plan/v1.0.0
npm run receipt --prefix contracts/research-plan/v1.0.0
```

The Pennsylvania finance/utilization/identity fixture intentionally remains
`ready_with_constraints`: its common coverage stops at 2024, CCN linkage is
candidate, PHC4 label-to-CCN crosswalk work is blocked, and facility-to-system
aggregation is a distinct unexecuted operation.
