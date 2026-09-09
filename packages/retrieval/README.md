# Observatory Retrieval v1.1.0

This immutable offline successor converts evidence-backed asset records into non-authoritative search documents, compiles questions with a deterministic controlled vocabulary, ranks candidate assets, preserves access and provenance, and returns explicit join-route objects through one discovery-result contract shared by the browser and agent surfaces.

The additive v1.1 contract keeps the `observatory-discovery-result.v1.0.0` compatibility envelope while adding canonical ranking provenance, generation-pinned cursor traversal, complete-collection record facets, partial-catalog notices, tri-state geography/time/access compatibility, named-source coverage gaps, separate metadata dimensions and dates, freshness, text-quality flags, and a page-scoped search receipt. Geography aliases remain excluded from lexical evidence, and a national record is never promoted to documented state coverage without evidence.

## Offline fixture workflow

```bash
npm install --ignore-scripts
npm test
npm run validate:publication
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

## Publication and traversal validation

`validate:publication` reads the production v1.2 manifest and all declared record shards, checks every record against the same canonical contract imported by the browser, and verifies the manifest row count. Runtime loading repeats that check per record: an incompatible item is isolated and disclosed through `partial_results` while valid records remain searchable. This is defense in depth; the current four incompatible production records remain an explicit release blocker even though runtime isolation keeps the other 3,430 searchable.

Cursor traversal is pinned to the catalog generation, normalized question, structured constraints, facet filters, selected sort, and page size. `ranking.ordered_ids` always describes the current page. Facet counts use records across the complete filtered match collection before pagination and are never approximate.
