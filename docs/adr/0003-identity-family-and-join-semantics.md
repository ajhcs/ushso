# ADR 0003: Identity, family, and join semantics

- **Status:** Accepted
- **Decision date:** 2026-08-30
- **Decision owners:** Identity, Data, Metadata, Search, Planner, Research UX
- **Accountable approver role:** Identity domain owner
- **Acceptance basis:** Authoritative plan-execution directive dated 2026-08-30
- **Implementation state:** `in_progress`
- **Supersedes:** None
- **Superseded by:** None

## Mapped requirements and tests

| Source | Requirement or test |
|---|---|
| Plan | §5 invariants 5–7; §§7, 8.2, 11, 12, 13.2, 14.2–14.3, 20 (WP2, WP6–WP8, WP10–WP12), 22.1, 22.5, 23.1–23.3, 23.9, 25, and 28 |
| Tester requirements | TST-ID-01, TST-PLAN-01, TST-FIT-01, TST-MCP-01, TST-MCP-03, TST-MCP-05 |
| Acceptance tests | `identity-resolution-benchmark`, `identity-exact-policy.contract`, `identity-reversal-integrity`, `join-route-semantics.contract`, `candidate-join-no-upgrade`, `machine-interface-parity`, planner safety fixtures |

## Context

Health-data metadata contains similar titles, mirrored catalog records, evolving
releases, parent/campus/system relationships, and identifiers whose meanings
change by namespace, entity type, grain, and effective date. A Medicare-certified
facility, legal filer, licensed hospital, NPI organization, campus, and
consolidated health system are not interchangeable.

Three useful but independent questions are often conflated:

1. Are two source-native observations the same canonical object?
2. Do two assets or releases belong to a version, mirror, successor, format, or
   collection family?
3. Can two exact releases be joined for a named research purpose?

False identity merges destroy provenance and can make reversal impossible.
Conversely, treating family membership or a possible key as identity can cause
the planner to overstate compatibility, coverage, or analytical feasibility.

## Decision

### Separate graphs and states

Represent canonical identity, family/lineage, and join/transformation semantics
as distinct evidence-bearing structures. No edge in one structure implies an
edge or status in another:

- identity answers object equality within a defined namespace/entity/time scope;
- family edges express typed relationships such as `version_of`, `mirror_of`,
  `successor_of`, `format_variant_of`, and `collection_member`;
- join routes describe a research-purpose-specific operation between exact
  fields and releases.

All truth-bearing observations, proposals, decisions, memberships, and edges are
append-only and superseded rather than overwritten. Source-native observations
and identifiers are never deleted when a public cluster is formed.

### Candidate representation

An identity/family candidate stores a canonically ordered object pair,
candidate type, algorithm and feature versions, feature evidence, match score,
epistemic confidence, state, creation/review times, and lineage. Allowed states
are `open`, `accepted`, `rejected`, `deferred`, and `superseded`. Match score and
epistemic confidence remain separate fields.

Candidate generation is deterministic for a pinned algorithm/feature version.
It may use identifier, locator, title/publisher, temporal, lineage, and semantic
features for blocking and proposals. Title, organization, description, URL, or
embedding similarity can only emit a review candidate; none proves equality.
Conflicting exact identifiers quarantine the proposal rather than selecting a
winner.

### Exact automatic resolution policy

Automatic identity resolution is disabled by default per namespace/rule. It may
be enabled only when all of these are true:

1. The namespace registry names the issuing authority, entity and grain scope,
   case/normalization/check rules, uniqueness/reuse policy, and effective dates.
2. Both assertions use the same namespace and normalized value.
3. Entity types and grains are compatible.
4. Effective periods overlap and are complete enough to evaluate reuse.
5. No conflicting authoritative identifier or parent/campus ambiguity exists.
6. The rule's sealed benchmark stratum passes ADR acceptance gates and the
   enabling decision is recorded.

A source-native identifier is exact only inside that source unless an
authoritative cross-source mapping explicitly broadens its scope. Missing dates,
identifier reuse, recycled CCNs/licenses, or entity/grain ambiguity always emit
a candidate for review. Exact source-declared release lineage may group releases
inside one asset when namespace and temporal rules agree; it still does not
prove cross-source object identity.

### Human review and reversal

Review decisions are `same_identity`, `not_same_identity`, `family_member`,
`mirror_of`, `successor_of`, `defer`, or `needs_more_evidence`. Every decision
records reviewer identity/role, rationale, evidence references, algorithm
version, decision time, and supersession lineage.

An accepted identity decision creates a derived projection cluster. It never
destructively coalesces canonical observations. A superseding reversal
deterministically rebuilds clusters, aliases, search projections, relevant join
views, and plan fixtures from remaining accepted state. Open, ambiguous,
deferred, rejected, and superseded candidates remain auditable and never appear
publicly as equality.

Legacy public identifiers remain permanent aliases. Alias resolution exposes the
current cluster/pin without erasing the historical source-native member.

### Temporal identity graph

Identifier assertions and relationships carry effective intervals and evidence.
The graph supports CCN, NPI, EIN, FIPS, state license, legal entity, campus, and
parent-system namespaces without treating them as universal keys. Queries and
plans use the identity snapshot applicable to the requested interval and pinned
canonical revision; they cannot substitute the current graph for historical
identity.

### Join and transformation semantics

A route is bound to exact `SchemaField` IDs, schema snapshots, releases or
distributions, applicability interval, research purpose, source/target grain,
identifier namespace, direction, cardinality, lossiness, preconditions,
validation checks, and evidence. Represent each step with independent axes:

- `operation_kind`: `join`, `crosswalk`, `aggregate`, `filter`,
  `temporal_alignment`, or `measure_harmonization`;
- `evidence_state`: `unknown`, `candidate`, `ambiguous`, `documented`,
  `observed`, `executed`, or `proven`;
- `compatibility`: `compatible`, `conditional`, `incompatible`, or `unknown`;
- `requirements[]`: typed prerequisites and their satisfaction state;
- `blockers[]`: unresolved conditions preventing a ready recommendation.

`executed` and `proven` require explicit external or controlled-test evidence;
they never mean USHSO executed a public user's plan. `crosswalk_required` is a
requirement, not compatibility or evidence. `blocked` is derived from unresolved
blockers. A same-named field is not a documented route, aggregation is a grain
change rather than an identity mapping, and aggregation never substitutes for a
crosswalk.

The 14 legacy join routes must receive explicit field/release/evidence mappings
during import. If legacy evidence cannot satisfy the new state definition, the
route remains candidate, ambiguous, unknown, or blocked; migration never upgrades
it for compatibility.

### Public and planner behavior

Only accepted identity or an enabled exact-policy relationship may collapse
search results or expose equality. Family results disclose family type and
resolution state. Join endpoints and plans expose all five operation axes,
applicability, evidence, and observation time. Candidate routes never become
documented/proven, and family/source placeholders never satisfy an exact
executable asset/release/distribution requirement.

The planner may traverse at most its contract-bounded number of graph hops and
must preserve unknowns, conflicts, requirements, blockers, grain changes, and
human authorization gates. It recommends instructions only; no graph operation
or identity merge executes on a public request.

### Release gates

Each launch-critical automatic rule/namespace stratum needs at least 50
adjudicated positive pairs, 50 hard-negative pairs, and 20
temporal/reuse/conflict cases. A stratum below this floor remains candidate-only.
Promotion additionally requires:

- zero false automatic merges on the negative set;
- candidate-generation recall at least 95% on eligible positives, reported by
  identifier/entity stratum;
- no unresolved relationship rendered as equality;
- explicit denominators for unresolved and review-pending rates;
- double-review agreement at least 90% and Cohen's kappa at least 0.80 on at
  least 100 pairs, or the whole eligible set when smaller;
- 100% reversal integrity without deletion or orphaned lineage;
- zero unsupported join upgrades in search and planner gates.

## Alternatives considered

### Fuzzy-score threshold automatic merges

Rejected. Similarity is useful for candidate generation but is not authoritative
evidence of equality, especially across organizations, time, and grain.

### One universal provider identifier table

Rejected. Real identifiers name different legal, regulatory, billing, facility,
campus, and system concepts and may be reused over time.

### Model versions, mirrors, identity, and joins as one relationship type

Rejected. The relationships answer different questions and require different
evidence, applicability, review, and public rendering.

### Destructively merge accepted records

Rejected. It loses source lineage, prevents deterministic reversal, and violates
append-only truth history.

### A single join status such as `possible` or `blocked`

Rejected. It conflates operation kind, evidence, compatibility, prerequisites,
and blockers and invites the planner to upgrade weak claims.

### Treat aggregation as resolution of entity identity

Rejected. Aggregation changes grain and can only be an explicit transformation;
it does not prove that entities are the same.

## Consequences

- Public results may contain near-duplicates while evidence is unresolved. This
  is an intentional safety outcome, with review state visible.
- Namespace governance and adjudicated benchmarks are prerequisites for any
  useful automatic collapse.
- Reversal requires deterministic downstream rebuilds, increasing projection
  work but preserving truth and auditability.
- Join records are more verbose, yet planners and researchers can distinguish
  feasibility, evidence, prerequisites, and actual blockers.
- Historical questions require effective-time queries rather than current-state
  shortcuts.
- Search ranking may expand accepted families or supporting routes but cannot
  infer identity or upgrade join evidence.

## Compatibility and rollout

WP2 freezes schemas, state machines, semantic validators, and adversarial
fixtures. WP6 imports legacy records and routes without silent merges. WP7 adds
candidate generation, review, reversal, family, schema, and access enrichment.
WP8 publishes only accepted/exact-policy clusters. WP10–WP12 consume the same
identity and join services. Static v1 behavior remains available for rollback,
but successor public claims use the stricter semantics.

## Implementation and verification

| Control | Owner | State | Receipt target |
|---|---|---|---|
| Canonical identity/family/join decision | Identity + Architecture | implemented | `verification/wp0/v1.0.0/receipts/identity-semantics-adr.json` |
| Contracts, validators, and adversarial fixtures | Contracts + Identity | not_started | `verification/wp2/v1.0.0/receipts/identity-join-contracts.json` |
| 157-record/14-route import mapping | Data + Identity | not_started | `verification/wp6/v1.0.0/receipts/legacy-semantic-mapping.json` |
| Sealed identity benchmark and adjudication | Identity + Research review | not_started | `verification/wp7/v1.0.0/receipts/identity-adjudication-reversal.json` |
| Public projection equality and reversal behavior | Identity + Search | not_started | `verification/wp8/v1.0.0/receipts/identity-projection-rebuild.json` |
| Planner and machine-interface no-upgrade parity | Planner + Machine interfaces | not_started | `verification/wp12/v1.0.0/receipts/identity-join-parity.json` |

## Unresolved and externally authorized work

No identity namespace is authorized for automatic resolution by this ADR alone.
Each rule remains candidate-only until its registry policy, benchmark stratum,
double review, and enablement receipt pass. The reviewer roster, access controls,
and adjudication policy require product/security approval before live review.
No public request, deployment, or operator action may merge identities without a
separately authenticated, audited review decision.
