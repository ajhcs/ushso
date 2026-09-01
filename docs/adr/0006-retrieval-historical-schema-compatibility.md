# ADR 0006: Retrieval historical-schema compatibility boundary

- **Status:** Accepted
- **Decision date:** 2026-08-31
- **Decision owners:** Retrieval, Contracts, Architecture, Data
- **Accountable approver role:** Architecture owner
- **Acceptance basis:** Research Navigator resume objective and WP8 handoff
- **Implementation state:** `implemented`
- **Supersedes:** None
- **Superseded by:** None

## Mapped requirements and tests

| Source | Requirement or test |
|---|---|
| Resume objective | Resolve the historical retrieval-schema issue without weakening or falsifying the historical pin |
| Plan | §5 versioning invariants; §§13.1, 13.3, 20, 28.2, and 28.8 |
| Tester requirements | TST-RET-01, TST-TRUST-01 |
| Acceptance tests | `legacy-schema-compatibility`, `retrieval-package-validate`, `wp0-adr-documentation` |
| Acceptance evidence | `packages/retrieval/tests/legacy-schema-compatibility.test.mjs`; `packages/retrieval/validation/legacy-schema-compatibility-receipt.json`; `verification/wp0/v1.0.0/receipts/adr-documentation-audit.json` |

## Context

The immutable retrieval v1.0.1 manifest records the historical schema path
`observatory/index/v1.0.0/schemas/observatory-record.schema.json` and the exact
SHA-256
`2d778a3125ba03c7504aad92e7154fdedf686db66619e439a6259ba883e162d9`. The
schema bytes are not committed in this repository and were not recovered from
the locally available Git object history. A different or looser schema cannot
be substituted while retaining that historical digest claim.

## Decision

1. Preserve the historical path and digest unchanged in
   `packages/retrieval/manifests/corpus-manifest.json`.
2. Do not report the historical schema as recovered, and do not assert
   byte-equivalence to it.
3. Add the explicitly versioned local successor
   `packages/retrieval/schemas/observatory-record-compatibility.v1.0.1.schema.json`.
   It is a strict JSON Schema 2020-12 document: all defined objects reject
   unknown properties, required fields are declared, and the accepted
   `observatory-record.v1.0.0` value is constrained explicitly.
4. Use the successor for local retrieval record validation and fixture builds.
   Keep the wire record version unchanged; this is a validation compatibility
   boundary, not a wire-version rewrite.
5. Publish a dedicated compatibility receipt that names the unavailable
   historical artifact, successor digest, validated record count, negative
   unknown-property case, and zero external actions.

## Alternatives considered

### Claim that the missing schema was recovered

Rejected. The exact bytes and digest cannot be established from available
repository evidence.

### Copy a current or inferred schema into the historical path

Rejected. That would make the manifest hash materially misleading and could
weaken the historical contract without an auditable migration.

### Leave retrieval validation broken

Rejected. The package needs a local, strict validation path while the historical
limitation remains visible and preserved.

## Consequences

The retrieval corpus remains historically pinned and its record wire version is
unchanged. Local validation now has an explicit, reproducible schema boundary,
but a PASS from the successor receipt does not prove that the missing historical
schema had the same valid/invalid set. Any future recovery of the exact bytes
must be a separate provenance event and must not overwrite the successor or
silently change the historical pin.

The receipt is local fixture evidence only: no source network, payload, identity
index, or external authorization boundary is used.

## Compatibility and rollout

The v1.0.1 corpus manifest pin remains immutable. Local validation switches to
the versioned successor without rewriting wire `schema_version`. Recovery of the
historical bytes, if it ever occurs, is a new provenance event and a successor
ADR; it must not overwrite this successor or the historical digest. Evaluation
bridge and WP8 quality receipts keep their existing corpus and algorithm pins
and must not be rewritten to claim historical-schema recovery.

## Implementation and verification

| Control | Required verification | Receipt target |
|---|---|---|
| Historical pin preserved | Manifest path/digest unchanged; historical file absent | `packages/retrieval/validation/legacy-schema-compatibility-receipt.json` |
| Strict successor | `additionalProperties: false`, required fields, explicit `schema_version` constraint; unknown nested property rejected | `packages/retrieval/tests/legacy-schema-compatibility.test.mjs` |
| No equivalence claim | Receipt records `exact_bytes_recovered=false` and `equivalence_claim=false` | `packages/retrieval/validation/legacy-schema-compatibility-receipt.json` |
| WP0 ADR audit | Indexed, linked, mapped, byte-pinned | `verification/wp0/v1.0.0/receipts/adr-documentation-audit.json` |

## External authorization and unresolved evidence

No AUTH register entry is consumed by this decision. Exact historical schema
bytes remain unrecovered. A local successor `PASS_LOCAL_COMPATIBILITY` is not
proof of the historical valid/invalid set and does not authorize AUTH-13
retrieval holdout evaluation, live source contact, or production promotion.
