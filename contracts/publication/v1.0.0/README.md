# USHSO publication contract v1.0.0

This immutable contract package defines the production publication boundary for
USHSO. It freezes the complete, exact-revision snapshot strategy selected in
ADR 0004: `W1` is an ordered manifest of exact canonical revision IDs and
revision hashes, every component is rebuilt as a complete as-of-`W1` snapshot,
and a single pointer transaction promotes one coherent publication manifest.
No active generation is updated in place.

The contract is deliberately metadata-only. Projection documents are marked
`source_of_truth: false`; no schema in this package permits source data rows,
analytic execution, identity merging, market-share calculation, financial
benchmarks, rankings, or other analytical outputs.

## Contract surfaces

- `canonical-revision-manifest.schema.json` is the sealed W1 membership fence.
  It lists one exact revision per canonical object plus every required component
  projection obligation. A sequence maximum is not a valid substitute.
- `projection-document.schema.json` and
  `projection-acknowledgement.schema.json` separate deterministic public
  documents from the complete obligation ledger. Public eligible revisions must
  project; excluded, quarantined, tombstoned, and internal revisions receive an
  explicit exclusion acknowledgement with `absence_claim_permitted: false`.
- `component-generation-manifest.schema.json` seals each asset,
  release/distribution, schema-field, source, join-edge, SEO, and coverage
  generation with exact W1 and checksum pins.
- `full-snapshot-build-receipt.schema.json` records all nine required barriers,
  complete reconciliation counts, the selected full-snapshot strategy, and a
  two-build determinism receipt. `partial_unpublished` is intentionally not a
  promotable outcome.
- `publication-manifest.schema.json` pins all seven components, the canonical
  as-of time, coverage snapshot, build receipt, visibility policy, N-1 Worker,
  previous publication, and emergency static fallback.
- `publication-pointer.schema.json` and `publication-history.schema.json`
  require the active pointer and append-only history event to share one atomic
  transaction. Public adapters resolve this pointer once with caching disabled,
  then pass every immutable pin explicitly to cacheable reads.
- `generation-state-event.schema.json` records the append-only lifecycle
  `building -> validated -> published -> retired`, rejection branches, rollback
  restoration, and audited physical expiry. A retained retired pin is served;
  at or after `retained_until`, clients receive `restart_required` rather than a
  silent repin.
- `legacy-static-compatibility-manifest.schema.json` pins the 157-record v1.1.0
  static rollback corpus. Search is only available in its declared static
  scope. SEO, coverage, and planner capability are typed `unknown`, never
  fabricated, and never authorize an absence claim.

## Canonical digest taxonomy

`contracts/digest-taxonomy.json` is normative. All digests use SHA-256 over:

```text
utf8(domain_prefix + "\n" + ushso_canonical_json_v1(value))
```

`ushso-canonical-json-v1` recursively orders object keys by Unicode code point,
preserves array order, emits no insignificant whitespace, and uses ECMAScript
JSON scalar encoding. Domain separation prevents a checksum from one artifact
class from being substituted into another.

Projection document checksums deliberately exclude `generation_id` and
`projected_at`; those fields identify a build but are not semantic content. Thus
two independent generations from the same W1 and projector can prove identical
document content. Component and full-build checksums similarly exclude run IDs
and timestamps while including exact W1, projector/schema fingerprints,
document checksums, normalized acknowledgements, barriers, and counts. A sealed
publication digest includes its complete coherent pin set.

## Atomic promotion protocol

1. Seal and hash the exact canonical revision membership manifest.
2. Build all seven component generations from exactly that manifest.
3. Acknowledge every declared obligation as `projected` or an explicit
   non-public exclusion; reconcile references, counts, visibility, and checksums.
4. Require all nine build barriers to pass and verify repeated full-build
   determinism.
5. Seal a publication manifest with N-1 and static rollback pins.
6. In one PostgreSQL transaction, append the history event and replace the
   singleton active pointer. Failure before commit leaves the last-known-good
   pointer unchanged.

The schemas express closed shapes and constants; `tools/semantics.mjs` enforces
cross-object membership, exact reference resolution, count reconciliation,
digest computation, lifecycle transitions, retention deadlines, and pointer
atomicity. JSON Schema alone is not treated as sufficient.

## Offline verification

From the repository root:

```bash
npm run fixtures --prefix contracts/publication/v1.0.0
npm run manifest --prefix contracts/publication/v1.0.0
npm run receipt --prefix contracts/publication/v1.0.0
npm test --prefix contracts/publication/v1.0.0
npm run validate --prefix contracts/publication/v1.0.0
```

Validation performs no network requests, database writes, or publication
pointer writes. The valid fixture contains current and previous publications,
14 component generations, public and quarantined obligations, lifecycle
history, expiry-boundary cases, and a pinned static fallback. The adversarial
suite mutates W1 membership, digests, acknowledgements, barriers, visibility,
component sets, retention, lifecycle transitions, history transactions,
fallback capability states, and rollback pins; every case must fail closed with
its named error.

Release tooling must generate `manifests/package-manifest.json` last (the
manifest and validation receipt are its only declared self-referential
exclusions), then generate and validate
`validation/validation-receipt.json`. Existing v1 artifacts remain byte-frozen;
any incompatible change requires a new contract version.
