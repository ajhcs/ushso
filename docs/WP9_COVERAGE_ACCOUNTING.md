# WP9 coverage accounting implementation

WP9 is implemented as a versioned successor package at
`packages/coverage/accounting/v1.0.0`. It preserves the frozen WP1 adapters and
does not change public routes, Worker composition, databases, or production
state.

The package reconciles repository evidence at its actual grain. The federal
fixture proves a 14-source metadata-route baseline with applicability modes 11
direct, 2 crosswalk-required, and 1 unknown. The readiness registry proves 51
jurisdiction labels and aggregate legacy statuses. The production corpus proves
157 published records and its six-slice composition. These counts use different
units, overlap, and are never summed.

The six planned state source classes produce a registry-derived 51 × 6 matrix.
Because no pinned artifact assesses those pairs at source-class grain, all 306
cells are `not_assessed`, their agency/operator is unidentified, their last
complete enumeration is null, and absence claims are denied. Jurisdiction-level
legacy labels remain provenance only. Synthetic fixtures exercise the seven
state renderings and denominator failure paths but are explicitly barred from
public loading.

The sealed snapshot contains the frozen 18-metric contract, membership
manifests, revision pins, full configured-scope and normalization partitions,
five coverage panels, non-additivity disclosures, and bounded service views.
Unknown and not-applicable values are explicit and never folded into pass/fail.
Failures remain in due-denominator conformance fixtures, and incomplete or
failed enumeration cannot create a zero-item absence claim.

The public copy candidate uses the exact positioning:

> 14-source, live-metadata-validated federal baseline plus selected state coverage

It also explains that metadata validation does not establish payload access,
row coverage, schema completeness, authorization, research fitness, or
exhaustive national/state coverage. This wording remains pending external
product-owner review and is not authorized for publication.

The proposed `0011_coverage_facts_definitions_snapshots` SQL is reviewed and
tested as an additive draft outside `db/`. It remains sequence-blocked behind
0007–0010 and requires the normal migration, authorization, and rollback gates
before application.
