# Observatory Retrieval v1.0.1

This immutable offline successor converts evidence-backed asset records into non-authoritative search documents, compiles questions with a deterministic controlled vocabulary, ranks candidate assets, preserves access and provenance, and returns explicit join-route objects through one discovery-result contract shared by the browser and agent surfaces.

The successor fixes the v1.0.0 validation failure in which an inferred geography name could count as the only lexical relevance signal. In v1.0.1, geography aliases are removed from lexical evidence; geography-only retrieval is permitted only through an explicit structured geography filter. A zero-result response remains explicitly non-evidence of corpus-wide absence.

## Offline fixture workflow

```bash
npm install --ignore-scripts
npm test
npm run build:fixture
npm run validate
npm run example
```

No command performs network discovery, payload acquisition, coverage execution, identity resolution, or deployment. Generated corpus outputs are immutable: changed inputs or code require another versioned successor.

## Historical record-schema compatibility

The v1.0.1 corpus manifest intentionally preserves the historical pin
`observatory/index/v1.0.0/schemas/observatory-record.schema.json` at SHA-256
`2d778a3125ba03c7504aad92e7154fdedf686db66619e439a6259ba883e162d9`. Those
exact historical bytes are not present in this checkout, so the pin is not
treated as recovered or byte-equivalent. Local record validation uses the
strict, separately versioned successor
[`schemas/observatory-record-compatibility.v1.0.1.schema.json`](schemas/observatory-record-compatibility.v1.0.1.schema.json),
with provenance, adversarial tests, and a dedicated receipt in
[`validation/legacy-schema-compatibility-receipt.json`](validation/legacy-schema-compatibility-receipt.json).

The record wire value remains `observatory-record.v1.0.0`; the successor is a
validation compatibility boundary, not a claim that the historical schema was
recovered.

## Analytical-use guidance

[`analysis-use/v1.0.0/README.md`](analysis-use/v1.0.0/README.md) describes the separately versioned Use Card compiler. It consumes a pinned `hc-metrics` requirements catalog and evidence-reviewed dataset mappings to report analytical fit without calculating metrics or changing the Observatory discovery UI.

The pin's `source.project_id` is an asserted logical project identifier, not an
attestation of repository origin. `source.origin_verified` is therefore fixed to
`false`. The importer reads an exact commit and blob paths from a local Git
object database with Git replacement objects and caller-supplied Git
configuration environment variables disabled, then publishes canonical bytes
without overwriting an existing complete, partial, or raced target. The verified
loader checks the locally published byte lengths and SHA-256 digests, validates
the catalog against its pinned schema, and applies the Observatory's semantic
and fail-closed authority checks.

That local verification does not prove who supplied the Git object database,
authenticate a remote, verify a signed commit or tag, or independently anchor
the revision and blob IDs. A production import must add an independently
trusted revision or artifact-signature anchor before treating upstream origin
as attested.
