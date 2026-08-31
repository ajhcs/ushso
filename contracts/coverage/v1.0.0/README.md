# USHSO Coverage Contract v1.0.0

This immutable contract makes public coverage claims reproducible. It implements
the coverage accounting requirements in sections 8, 15.1, 16, 20/WP2 and WP9,
22.1, 22.6, 23.4, and 28 of the Research Navigator implementation plan. The
normative human vocabulary is
[`docs/COVERAGE_DENOMINATOR_GLOSSARY.md`](../../../docs/COVERAGE_DENOMINATOR_GLOSSARY.md).

The package is metadata-only and performs no harvesting, source-data access, or
analytics. Validation is fully offline.

## Contract contents

- `contracts/metric-definitions.json` freezes all 18 required metrics, their
  typed units, executable definition versions, allowable denominators, stage
  boundaries, filters, partition equations, pins, and overlap policies.
- `contracts/digest-taxonomy.json` distinguishes exact file-byte hashes from
  logical canonical-JSON, membership-manifest, and snapshot digests. A digest
  label can therefore never be reused with ambiguous canonicalization.
- `schemas/` contains strict JSON Schema 2020-12 contracts. Every object rejects
  unexpected properties.
- `fixtures/valid-package.json` is a complete conformance example: five source
  registry states, 18 stage facts, 18 metric manifests and metrics, and a
  state/federal matrix that exercises all seven canonical cell states.
- `fixtures/adversarial-cases.json` is a mutation corpus for denominator
  omission, unit mixing, partition drift, failure-derived absence, exclusion
  laundering, overlap addition, zero-denominator percentages, stale pins, and
  unknown/not-applicable/unclassified loss.
- `validation/validation-receipt.json` records offline schema and semantic
  validation results. `manifests/package-manifest.json` binds every normative
  package file to its exact bytes.

## One semantic truth boundary

A public metric is not a bare number. It resolves to one immutable membership
manifest and carries its metric/version, concrete unit, numerator and
denominator definition versions, counts, rate or explicit `null`, unknown,
not-applicable, excluded and unclassified counts, as-of time, reporting window,
cohort filters, overlap disclosure, and every revision pin. The manifest digest
is recomputed from domain-separated canonical bytes.

The validator enforces:

```text
normalized + pending + failed + excluded + not_applicable + unknown = ingested
active + paused + excluded + retired + unassessed = configured
```

All members are typed. Release and distribution instances of schema coverage
must be reported separately. Native items cannot be divided by canonical
assets, and overlapping jurisdiction or aggregator cohorts cannot be marked
additive. A known zero denominator has a `null` rate and renders as `0 of 0`,
never 0% or 100%.

An `absence_claim_permitted` value is independently checked at the source-scope,
metric, and matrix-cell boundaries. Failed or incomplete enumeration, unknown
membership, missing generation pins, and non-integrated assessment states fail
closed. Partial observations may be labeled `observed_processing_yield`; they
cannot become an inventory-completeness or zero-item claim.

## Canonical digest taxonomy

| Digest ID | Input | Use |
|---|---|---|
| `package_file_bytes_sha256/v1` | Exact physical bytes | Package-file integrity |
| `canonical_json_sha256/v1` | `ushso_canonical_json_v1` plus its domain separator | Logical JSON registries |
| `coverage_membership_manifest_sha256/v1` | Complete immutable membership manifest | Public numerator/denominator evidence |
| `coverage_snapshot_sha256/v1` | Snapshot excluding only its self-referential digest field | Immutable snapshot identity |

Canonical JSON is UTF-8, has lexicographically code-point-sorted object keys,
preserves array order, admits finite JSON numbers only, normalizes negative zero,
and has no insignificant whitespace or terminal newline.

## Verification

Run with the repository's installed Node.js dependencies:

```sh
npm run fixtures --prefix contracts/coverage/v1.0.0
npm run manifest --prefix contracts/coverage/v1.0.0
npm test --prefix contracts/coverage/v1.0.0
npm run validate --prefix contracts/coverage/v1.0.0
npm run receipt --prefix contracts/coverage/v1.0.0
```

`fixtures` is deterministic. Run `manifest` after any normative file changes,
then test and validate. The public `test` and `validate` commands are byte-read-
only; only the explicit `receipt` command may promote a new timestamped receipt.
Publishing a changed contract requires a new version directory; v1.0.0 is not
modified in place after promotion.
