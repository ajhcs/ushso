# Analysis Use Cards v1.0.0

This versioned, offline contract turns the pinned `hc-metrics` analytical requirements catalog into USHSO discovery guidance. It answers which reviewed datasets, or bounded sets of up to three datasets, supply the inputs and compatibility evidence an analysis requires. It does not calculate a metric, authorize data access, or publish an analytical result.

## Contract flow

1. `scripts/import-analysis-requirements.mjs` validates the Toolkit JSON Schema and semantic references, requires an exact local Git commit, reads the named commit's blobs with replacement objects disabled, canonicalizes the bytes, and publishes an immutable SHA-256 pin.
2. `tools/verified-analysis-requirements.mjs` verifies the pin, catalog, schema, authority boundary, and semantic integrity before exposing an opaque requirement handle to the compiler.
3. Evidence reviewers create analysis-specific input profiles. Field names, grains, value kinds, units, domains, availability, and any derivation must be cited; the compiler does not infer them from catalog prose.
4. Multi-dataset sets require exact-set assertions for every analytical property and evidence-grounded semantic joins resolved against canonical Observatory join routes. Each semantic join names one coupled Toolkit alternative, binds its logical endpoint discriminators separately from its route keys, and must satisfy route direction plus cardinality (including a verified inverse when the route is stored in reverse).
5. `tools/analysis-use-cards.mjs` emits deterministic, evidence-addressed Use Cards with analytical family and acceptable grains; covered, missing, and unverified inputs; property and join status; the exact supporting route, alternative, and endpoints; temporal requirements; limitations; and a fail-closed truth boundary.

`supported` means all required inputs are explicitly mapped, all required properties are documented for that exact set, and every applicable join is documented. `partial` means at least one required input is covered but one or more gates remain unresolved. `unsupported` means no required inputs are covered. These statuses describe analytical fit only.

## Layout

- `upstream/` contains the exact Toolkit catalog, its strict schema, and the import pin.
- `schemas/` defines strict input-profile, compatibility, semantic-join, import-pin, and Use Card contracts.
- `fixtures/` is a synthetic Pennsylvania HHI conformance example. Its `example:` identifiers and evidence are not claims about the live Observatory corpus.

The pinned Toolkit catalog contains 15 atomic requirements spanning the ten requested analytical families. Financial metrics are split into six independently supportable ratios so a source can qualify for, for example, operating margin without falsely claiming all financial calculations.

The one-dataset example supplies four of five HHI inputs and remains `partial`. The two-dataset example becomes `supported` only because the facility-to-system route, period alignment, market definition, and competitor-universe compatibility are all explicitly documented. Its limitations retain the fact that outpatient market activity is absent.

Rebuild the immutable synthetic cards with:

```bash
npm run build:analysis-use-fixture --workspace @ushso/observatory-retrieval
```

Import a reviewed Toolkit release with:

```bash
node scripts/import-analysis-requirements.mjs \
  --catalog /path/to/analysis-requirements.v1.0.0.json \
  --schema /path/to/analysis-requirements.v1.0.0.schema.json \
  --source-revision '<immutable Toolkit revision>'
```

Production corpus adoption requires separately reviewed profiles, exact-set compatibility assertions, and canonical join evidence. Existing topic labels, descriptions, candidate routes, or search relevance never become field-level analytical claims automatically. A Use Card identifies the exact requirement and evidence bytes that produced it, but still authorizes neither access nor calculation. Nothing in this package adds a dashboard or calculator to the Observatory.

The import pin's `project_id` is a logical project label, not a verified remote identity. `origin_verified` is deliberately `false`: the recorded commit and blob object IDs prove which bytes were read from the supplied local repository, but they do not attest that those objects came from an official Toolkit remote. Production promotion therefore needs an external trusted or signed revision anchor.

The v1 compiler accepts review artifacts directly, so it is a conformance and review primitive rather than a live publication authority. `validateAnalysisUseCard` is requirement-bound structural and self-consistency validation. It checks the card against the verified requirement and its own supporting-edge topology, but it does not resolve `evidence_sha256` or independently authenticate the evidence objects named by the card. A production publication path must bind artifacts to a pinned, verified Observatory evidence package and recompile or compare the resulting card; passing schema-valid objects to the compiler alone cannot create a live corpus claim. The emitted truth boundary therefore remains publication-denied.
