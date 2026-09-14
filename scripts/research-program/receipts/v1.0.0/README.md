# Research-program evidence receipt v1.0.0

Standalone additive contract. It is not an npm workspace and does not replace
`contracts/ingestion/*`. Released `ingestion.v1.0.0` metadata-fetch and
capture-reference schemas remain immutable; this receipt cites those records
when they exist and never inserts extra properties into them.

## Identity

- Contract: `ushso.research-program.evidence-receipt.v1.0.0`
- Schema: `evidence-receipt.schema.json` (JSON Schema 2020-12, every object
  `additionalProperties: false`)
- Composer: `scripts/research-program/operating-bounds.mjs`

## What a receipt may contain

Request type, expected content classes, safe final host/path, observed sizes
and hashes, source/parser identity, attempt outcome, and next action. Capture
raw/semantic hashes are copied only from a validated capture reference. A hash
of a retained rejected body is `observed_rejected_body_sha256` and does not
prove capture, payload access, or schema validity.

`payload_access_verified` is always false. HTTP status is not content success.
Truncated bytes never imply complete schema validation.

## Historical Census negative

The retained `sample-census-acs` body is an unmatched historical observation,
not an approved Census metadata route. The receipt omits the historical query
URL, keeps `redirect_count` null, sets parser `not_run`, and records typed
access/content failure. Durable persistence is PR-010/011 scope.

## Descriptor hash

When present, `descriptor_hash.hash_basis` is named. This assignment selects
`ushso-canonical-json.v1`. Exact published descriptor bytes remain a distinct
unresolved claim. A 64-hex registry field without a named basis is not
sufficient for PR-010.

## Cross-record consistency and limits

Receipt source, route, capture pointer, hashes, and byte projections must agree
with the cited validated ingestion records. Fetch status, response bytes,
redirect count, and observation time are copied from the metadata-fetch record.
For a newly captured outcome, the records must describe the same run and
capture, including the capture connector version, media type, and byte counts.
A `not_modified` response may reuse a capture from an earlier run and older
connector version; the cached capture retains its original provenance.

`matched_descriptor_route` records a supplied route claim. The validator checks
the named hash format and record consistency, but has no approved-descriptor
resolver and does not independently prove registry approval or compare the
descriptor bytes with that hash. Before admission, PR-010 must resolve and
validate the actual approved descriptor and route, recompute the
`ushso-canonical-json.v1` digest, and verify it against the registered digest.
The resolver contract remains pending PR-010; this receipt module adds none.
