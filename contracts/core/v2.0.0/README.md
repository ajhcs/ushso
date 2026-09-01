# USHSO Core Contract v2.0.0

This immutable package defines the production canonical metadata truth boundary for the United States Health Systems Observatory. It is a successor to, and does not modify, core v1.

USHSO records public-source metadata, evidence, schema descriptions, access procedures, and conservative relationship claims. It does not contain healthcare dataset rows, retrieve source payloads, submit access applications, execute analyses, calculate market share, produce financial benchmarks, or rank organizations.

## Canonical records

The strict JSON Schema Draft 2020-12 contracts model:

- `Organization`: a responsible publisher, regulator, maintainer, or operator;
- `Source`: one configured catalog, portal, repository, inventory, or registry—not its operator organization;
- `Asset`: an enduring dataset, product, report series, registry, collection, crosswalk, or methodology;
- `Release`: one immutable edition, vintage, snapshot, filing period, or API version of an asset;
- `Distribution`: one retrievable manifestation of an exact release;
- `Documentation`: a codebook, methodology, schema guide, license, landing page, or access guide;
- `SchemaSnapshot` and `SchemaField`: an immutable observed schema and its source-native fields, scoped to an exact release and distribution;
- `AccessRoute` and `AccessObservation`: a non-executed acquisition procedure and append-only observation that independently records visibility, payload access, requirements, authorization, infrastructure, and freshness;
- `Evidence`: metadata-only provenance, locator, availability, and digest information;
- `Assertion`: one evidence-backed, time-bounded metadata claim; and
- `Relationship`: a typed identity, family, join, lineage, or provenance edge.

Every record boundary denies unevaluated properties. Nested objects deny additional properties. The common revision envelope preserves an opaque entity ID, immutable revision ID, exact source-native identifiers, legacy aliases, a semantic content fingerprint, four clocks, coverage intervals, evidence and assertion references, connector/normalizer lineage, and bidirectional append-only supersession history.

## Four clocks and history

The validator keeps data coverage, publisher time, observation time, and system record/supersession time separate. It rejects reversed intervals, publisher timestamps later than observation, record time before observation, invalid fiscal semantics, exact bounds attached to unknown coverage, one-way supersession, cross-entity supersession, multiple current revisions, and cycles. Prior revisions remain addressable.

## Evidence and unknown states

Every truth revision except an `Evidence` record requires one or more structured evidence references. Each reference identifies the exact claim paths it supports, observation time, evidence state, staleness, derivation lineage, and review status. References and JSON Pointer claim paths must resolve.

Missing, failed, blocked, stale, excluded, and unresolved states stay distinct. `not_found` is not an access or identity state. Catalog visibility never establishes payload access, and publisher documentation never establishes that USHSO or a researcher is authorized to retrieve anything.

## Identity, family, and join semantics

Identity equality, family membership, and join compatibility are independent domains:

- Algorithmic or similarity-based identity observations remain candidates. `same_identity` requires an accepted exact-authoritative-identifier or human-review decision. Automatic resolution additionally requires a registered authoritative namespace, compatible effective periods, and no conflicting identifier.
- A family edge explicitly fixes `identity_equality` to `false`. Version, mirror, successor, format, and collection membership never merge canonical entities.
- A join route references two exact `SchemaField` IDs and separately records operation kind, grain, namespace, direction, cardinality, lossiness, evidence state, compatibility, requirements, and blockers. Candidate or ambiguous evidence cannot become compatible, and executed/proven states require controlled-test or external-execution evidence. Aggregation never resolves identity.

Uncertain records stay separate and reviewable. Superseding a decision changes future projections; it does not delete source-native history.

## Fixtures and adversarial corpus

`bundle/valid-bundle.json` is a deterministic, offline metadata-only graph covering every record type, public and application-gated access, exact schema-field joins, unresolved identity, accepted family membership, and two assertion revisions with bidirectional history.

`fixtures/adversarial-cases.json` applies reproducible mutations for:

- access and authorization overclaim;
- four-clock and coverage contradictions;
- unresolved identity presented as equality;
- family membership confused with identity;
- candidate joins upgraded to proven;
- missing evidence;
- unknown collapsed to absence; and
- source-data or analytical result fields added to metadata records.

Every case names the rejection codes the validator must produce. Package validation fails if a case is accepted or any expected code disappears.

## Digest and manifest rules

[`DIGESTS.md`](DIGESTS.md) defines the executable distinction between an exact file-byte SHA-256 and a canonical JSON content fingerprint. `manifests/package-manifest.json` records both where applicable; `receipts/fixture-build.json` and `validation/validation-receipt.json` provide deterministic verification receipts.

## Build and verify

From this directory:

```sh
npm run build:fixtures
npm run manifest
npm run validate
npm run receipt
npm test
```

The fixture builder is offline-only and rejects network, full-data, payload-acquisition, and analysis flags. It writes no source data and contains no request-time harvesting path.
