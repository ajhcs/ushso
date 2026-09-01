# Coverage denominator glossary

**Contract status:** normative vocabulary for Coverage Contract `v1.0.0`  
**Authority:** Research Navigator implementation plan, especially sections 15.1,
16, and 23.4  
**Applies to:** coverage snapshots, the public coverage page, HTML, JSON API,
WebMCP, search metadata, planner disclosures, evaluation receipts, and
operational dashboards

This glossary fixes what USHSO counts and what it does not claim. A coverage
number is meaningful only with its unit, bounded cohort, numerator predicate,
denominator predicate, as-of time, membership evidence, and revision pins.
Public-source discovery is not proof of exhaustive inventory, usable payloads,
row coverage, authorization, schema completeness, or fitness for a research
question.

## 1. Metric envelope

Every metric instance MUST carry all of the following fields, even when a field
is explicitly `null`:

| Field | Required meaning |
|---|---|
| `metric_id` and `metric_version` | Stable identifier and executable-definition version. This document defines version `v1`. |
| `unit` | One typed counting unit from the metric table below. Units cannot be converted or combined implicitly. |
| `numerator_count` | Count produced by the versioned numerator predicate over the bounded cohort. |
| `numerator_definition_version` | Exact executable predicate revision used to create the numerator. |
| `denominator_count` | Count produced by the denominator predicate, or `null` when membership is not honestly knowable. |
| `denominator_definition` | Human-readable and executable denominator predicate, including the stage and reporting window. |
| `denominator_status` | Exactly `known`, `estimated`, or `unknown`. |
| `rate` | `numerator_count / denominator_count`, or `null` under the rules in section 7. |
| `unknown_count` and `not_applicable_count` | Explicit counts at the metric's own unit and stage; never silently folded into success or failure. |
| `as_of` and `reporting_window` | UTC predicate-evaluation instant and, where relevant, the inclusive/exclusive bounded window. |
| revision pins | Registry, source-scope, policy, connector, canonical, coverage-contract, and index revisions as described in section 8. |
| `cohort_filters` | Controlled dimensions and their explicit `unclassified` membership. |
| `membership_manifest_hash` | SHA-256 digest of the immutable membership evidence described in section 8. |
| overlap disclosure | Whether cohort members can also occur in another displayed cohort and why displayed totals are or are not additive. |

`numerator_count` and `denominator_count` are integers. A published estimate is
an estimate of the denominator, not a license to invent member IDs; it retains
`denominator_status = estimated`, the estimate method, uncertainty, and source
evidence. When no honest denominator exists, the denominator and rate are
`null` while an honest absolute count may still be shown.

## 2. Orthogonal axes

The following axes describe different facts. They MUST be stored and rendered
separately:

| Axis | Values fixed by the plan | What the axis answers |
|---|---|---|
| Milestone | `discovered`, `ingested`, `normalized`, `schema_indexed`, `search_indexed` | Which durable stage acknowledgements exist? Milestones are cumulative facts, not a mutually exclusive partition. |
| Inclusion | `included`, `excluded`, `quarantined`, `review_pending` | Is this unit eligible for the named downstream use under the pinned policy? |
| Pipeline | `healthy`, `pending`, `retrying`, `dead_letter` | What is the current processing condition at one exact stage? |
| Freshness | `fresh`, `stale`, `unknown`, `not_applicable` | Is a freshness-assessable unit current under one exact policy? |
| Access | `current_pass`, `current_typed_failure`, `check_stale`, `never_checked` | What does the governed access check currently establish? |
| Identity | `resolved`, `candidate`, `conflict`, `review_pending` | How certain is the identity or deduplication decision? |

An indexed asset may simultaneously be stale, inclusion-approved, identity
resolved, and associated with a failed refresh attempt. Likewise, a connector
scope can remain `active` while one run is `dead_letter`. Counts from different
axes are therefore **non-additive** and MUST NOT be presented as one pie or one
synthetic “coverage status.”

The token `excluded` is typed. An excluded connector scope, an excluded native
item, and an excluded canonical asset are three different policy decisions over
three different units. No implementation may join or aggregate them by the
label alone.

The jurisdiction/source-class assessment matrix is another separate axis. Its
versioned `coverage_cell_state` values are exactly:

`integrated`, `candidate`, `navigation_only`, `evidence_gap`, `inaccessible`,
`unknown`, and `not_assessed`.

Those values classify an assessment cell, not a record. An ordinary failed
refresh does not erase a previously evidenced `integrated` classification;
freshness and connector health remain separate axes.

## 3. Required metric definitions

The table below is normative. “Current” always means effective at the pinned
`as_of` and revisions, not whatever happens to be current when a page renders.

| Metric | Metric ID | Unit | Numerator | Denominator |
|---|---|---|---|---|
| Configured scope status | `coverage.configured_scope_status/v1` | Connector scope | For each registry state, connector scopes whose one effective state is that state at `as_of`. | Every configured connector scope in the same registry revision. Each scope occurs exactly once in the five-state partition. |
| Harvest completion | `coverage.harvest_completion/v1` | Connector scope | Due scopes for which a complete enumeration was durably persisted and sealed in the reporting window. | Connector scopes that were active, non-excluded, and due under the pinned cadence policy in that window. Partial, failed, retrying, and dead-letter attempts remain in this denominator. |
| Discovered inventory | `coverage.discovered_inventory/v1` | Native item | Distinct `(source_scope_id, native_id)` keys observed in the stated bounded runs. | No denominator for the absolute inventory count. A source-reported total may be used only when its authority, scope, unit, and completeness are evidenced and the relevant enumeration is sealed complete. Otherwise `denominator_count = null`. |
| Revision ingestion | `coverage.revision_ingestion/v1` | Native item revision | Raw revision observations durably captured, including content/evidence identity, by the capture boundary. | Every native-item revision observation emitted by the exact same bounded run set. |
| Normalized outcome | `coverage.normalized_outcome/v1` | Native item revision | Ingested revisions mapped to a canonical ID. A confirmed duplicate mapped to an existing canonical ID is normalized, not failed. | Every ingested native-item revision in the exact same bounded run set, partitioned by the six outcomes in section 4. |
| Canonical assets | `coverage.canonical_assets/v1` | Asset | Canonical assets effective at `as_of` under the pinned canonical revision and visibility scope. | Absolute count only; `denominator_count = null` and `rate = null`. |
| Canonical releases | `coverage.canonical_releases/v1` | Release | Canonical releases effective at `as_of` under the pinned canonical revision and visibility scope. | Absolute count only; `denominator_count = null` and `rate = null`. |
| Canonical families | `coverage.canonical_families/v1` | Family | Canonical families effective at `as_of` under the pinned canonical revision and visibility scope. | Absolute count only; `denominator_count = null` and `rate = null`. |
| Schema-indexed | `coverage.schema_indexed/v1` | Release/distribution | Current schema-eligible releases or distributions whose parsed schema is acknowledged by the active field-index generation. | Current schema-eligible releases or distributions of the same declared subtype. Release and distribution counts MUST be reported separately, never summed. |
| Search-indexed | `coverage.search_indexed/v1` | Asset | Normalized, inclusion-approved current assets acknowledged by the pinned active search generation. | Every normalized, inclusion-approved current asset in the same canonical snapshot. |
| Current-check coverage | `coverage.current_check_coverage/v1` | Endpoint/check target | Active governed targets with a non-expired observation under the exact check policy at `as_of`. | Every active target governed by that exact check-policy revision, whether or not it was due in this reporting window. |
| Due-check timeliness | `coverage.due_check_timeliness/v1` | Scheduled check target | Due targets for which an attempt began within the policy grace interval. A still-pending result counts as timely attempted, not as a pass. | Every active target due under that exact check policy in the reporting window. |
| Check pass | `coverage.check_pass/v1` | Checked target | Current checks whose typed result is `pass`. | Targets with a completed check within the policy SLA. Never-checked, expired, and still-pending targets are not silently recast as failures. |
| Stale | `coverage.stale/v1` | Named layer/unit | Freshness-assessable active units at the named layer whose policy-derived `stale_at` is earlier than `as_of`. | Every freshness-assessable active unit at the same named layer, unit subtype, and policy revision. |
| Failed | `coverage.failed/v1` | Stage work item | Attempted work items in a terminal or dead-letter state at the exact named stage and within the reporting window. | Every work item attempted at that exact stage in that exact window. |
| Overdue/not started | `coverage.overdue_not_started/v1` | Scheduled work item | Due work items for which no attempt began within the pinned policy grace interval. | Every work item due at that exact stage under that exact policy in the reporting window. |
| Excluded native items | `coverage.excluded_native_items/v1` | Native item | Native items explicitly excluded by the named native-item policy and version. | Every native item evaluated by that exact native-item policy version, including included, excluded, pending, and unknown outcomes. |
| Excluded canonical assets | `coverage.excluded_canonical_assets/v1` | Asset | Canonical assets explicitly excluded by the named asset-level policy and version. | Every canonical asset evaluated by that exact asset-level policy version, including included, excluded, pending, and unknown outcomes. |

The slash in `Release/distribution` identifies two allowed metric subtypes; it
does not create a mixed unit. A metric instance declares exactly one subtype.
Similarly, a `Named layer/unit` instance declares one concrete key space such as
asset, endpoint, or search generation. Never divide native items by canonical
assets, fields by distributions, connector scopes by jurisdictions, or source
counts by record counts.

## 4. Complete partitions

For one bounded run cohort, every ingested native-item revision receives exactly
one effective normalization outcome. The all-ingested invariant is:

```text
normalized + pending + failed + excluded + not_applicable + unknown = ingested
```

The six sets MUST be pairwise disjoint, and their union MUST equal the ingested
membership manifest. `retrying` is represented by `pending` at this outcome
boundary; terminal/dead-letter normalization is `failed`. A confirmed duplicate
that is linked to an existing canonical ID is `normalized`. An uncertain match
that still needs a decision is `pending` or `unknown` according to the
versioned predicate; it is never silently merged.

USHSO may additionally display an **eligible-only normalization rate** as:

```text
normalized / (normalized + pending + failed + unknown)
```

It MUST be labeled conditional, MUST pin the same run cohort and policy, and
MUST appear beside—not replace—the complete all-ingested outcome partition.

Every configured connector scope likewise receives exactly one registry state:

```text
active + paused + excluded + retired + unassessed = configured
```

Those five sets MUST be pairwise disjoint and exhaustive under one registry
revision. Harvest completion is a conditional operating rate over the active,
non-excluded, due subset. Its display MUST sit beside the complete configured
scope partition so pausing, retiring, or excluding a scope cannot manufacture a
better-looking program total.

## 5. Unknown, not-applicable, exclusions, and classification time

- `unknown` means evidence is missing, conflicting, unresolved, or insufficient
  under the executable definition. It is neither success nor failure. It stays
  visible in the all-member partition and in `unknown_count`.
- `not_applicable` requires an affirmative policy rule explaining why the named
  predicate does not apply to that member. Lack of evidence is `unknown`, not
  `not_applicable`. It is neither success nor failure and remains visible in
  `not_applicable_count`.
- `excluded` requires a typed policy, policy version, reason code, decision
  time, and affected unit. Excluded members remain visible in every upstream
  denominator in which they were observed or evaluated. A clearly named
  downstream eligible cohort may exclude them only while displaying the parent
  partition and pinned exclusion count alongside it.
- `unclassified` is the cohort-dimension bucket for a fact not yet knowable at
  the measured stage. A metric may filter only on dimensions known at or before
  that stage. A downstream classification must not remove an upstream member or
  rewrite its historical denominator.
- `pending` is active unresolved work. `failed` is a terminal typed result at an
  exact stage. Neither state authorizes an absence claim about the source.

Policy changes create a new policy revision and new snapshot. They do not
rewrite old manifests. Public comparisons across policy revisions disclose that
the cohort definition changed.

## 6. Enumeration and absence claims

A page, cursor, catalog, or list failure makes the affected enumeration
incomplete and unsealed. A failed enumeration MUST NOT:

- create a zero-item denominator or zero-item inventory claim;
- assert that an item, jurisdiction, source, release, or distribution is absent;
- withdraw a previously current member or advance a global checkpoint;
- convert unknown membership into excluded, not-applicable, or failed records;
- support a source-inventory completeness percentage.

Partial runs may report revision processing as **observed processing yield** for
their explicitly bounded emitted observations. They may not report source
inventory completeness. The last-known-good sealed membership remains the
effective public inventory until a later sealed run supersedes it. Only a sealed
complete enumeration with an admissible authoritative source total may support
an inventory-completeness claim.

An API absence response therefore includes `absence_claim_permitted`. It is
`true` only when the exact queried scope, unit, membership revision, and
enumeration evidence support the claim; otherwise it is `false` with a typed
reason such as `enumeration_incomplete`, `denominator_unknown`, or
`scope_not_assessed`.

## 7. Rates, zero denominators, and public rendering

Rate calculation follows these rules:

1. If `denominator_status = unknown`, then `denominator_count = null` and
   `rate = null`.
2. If a known denominator is zero, publish `0 of 0 <unit>` and `rate = null`.
   Zero denominator never means 0% or 100%.
3. If the denominator is estimated, label it **estimated**, publish its method,
   source, uncertainty, and evidence revision, and set `rate = null` unless the
   metric definition explicitly permits an estimated rate.
4. Absolute inventory metrics publish `n <unit>; denominator: none (absolute
   count)` and `rate = null`. They are not ratios.
5. A denominator-bearing metric with a positive known denominator displays
   `n of d <unit>` and the derived rate. It never displays a bare percentage.

Every public ratio, in HTML and machine interfaces, also displays or returns:

- the metric name and definition version;
- the counting unit and stage/layer;
- `n of d`, denominator status, and any unknown/not-applicable counts;
- `as_of` in UTC and the reporting window;
- the membership-manifest hash and all applicable revision pins;
- a “Why this denominator?” definition;
- exclusions, `unclassified` membership, and an overlap/non-additivity note.

For an unknown denominator the equivalent rendering is `n observed; denominator
unknown`, never `n of 0`. The JSON rate is `null`, not `NaN`, infinity, an empty
string, or an omitted property.

## 8. Membership manifests, as-of time, and revision pins

Every metric snapshot references an immutable, content-addressed membership
manifest. The manifest records:

- metric ID/version, concrete unit subtype, numerator and denominator predicate
  versions, `as_of`, reporting window, and cohort filters;
- stable typed member keys, with one occurrence per unit in the metric instance;
- each member's numerator/denominator role and explicit state or reason code;
- unknown, not-applicable, excluded, and `unclassified` members rather than only
  successes;
- the bounded connector run IDs and enumeration seal state where applicable;
- overlap-group keys or a declared proof that the cohort is disjoint;
- the estimate assertion and evidence, without fabricated members, when the
  denominator is estimated or unknown.

`membership_manifest_hash` is the lowercase SHA-256 digest of the canonical
manifest bytes. Counts MUST be reproducible from known-denominator manifests.
An unknown-denominator manifest hashes the bounded predicate and evidence gap;
it does not pretend to enumerate unknown members.

`as_of` is the UTC instant at which all effective-state predicates were
evaluated. It differs from the reporting window, source observation time,
payload publication/coverage time, ingestion time, and snapshot-generation
time. Implementations preserve those clocks separately and do not substitute
one for another.

Every snapshot pins these revisions, using an explicit `null` plus reason when a
pin truly does not apply:

- `registry_revision`;
- `source_scope_revision`;
- `policy_revision`;
- `connector_revision` and relevant connector configuration revision;
- `canonical_revision`;
- `coverage_contract_version` and `coverage_snapshot_id`;
- `index_generation` for search-, schema-, or public-generation-dependent
  metrics.

Public rendering reads the immutable snapshot and its pins. It never recomputes
counts against mutable “latest” rows while serving a request.

## 9. Jurisdiction, source, and record units

Source/operator scope and records' geographic coverage are different facts:

- A **connector scope** is keyed by `source_scope_id` under one registry
  revision. A federal or multi-jurisdiction source is one scope unless the
  registry explicitly defines separately harvested child scopes. It is not
  copied into 51 state-scope units for presentation.
- A **coverage assessment cell** is keyed by `(jurisdiction_id,
  source_class_id, registry_revision)`. Its state says what bounded assessment
  established for that cell. It does not count native items or prove record-row
  coverage.
- A **native item** is keyed within its source scope. A source operated in one
  jurisdiction may describe records for another or for many; operator location
  never supplies missing record geography.
- Canonical assets, releases, and distributions use canonical IDs. If one asset
  covers multiple jurisdictions, it counts once in the global asset inventory.
  It may also appear once in each explicitly requested jurisdiction cohort, but
  those cohort totals are visibly overlapping and MUST NOT be summed.
- Aggregators and their member sources are similarly non-additive. A portal
  total, state-cell total, federal-source total, and global canonical total use
  different units and cannot be combined into a national-completeness rate.

Jurisdiction cohorts may filter only on geography evidenced at or before the
measured stage. Otherwise the member stays in `unclassified`. A state/federal
matrix denominator is the pinned set of configured assessment cells, not “all
public healthcare data,” and each cell publishes its denominator type, evidence
revision, last complete enumeration, and next action.

USHSO's public positioning is therefore a **14-source,
live-metadata-validated federal baseline plus selected state coverage**. It does
not claim exhaustive national or state inventory, and it does not turn the
existence of 51 jurisdiction labels into 51 integrated jurisdictions.

## 10. Worked edge cases

1. **Failed catalog page:** 12 items were emitted before page 3 failed. The run
   may show observed processing yield for those 12 revision observations. Its
   inventory denominator is unknown, `absence_claim_permitted = false`, and the
   previous sealed inventory remains public.
2. **No checks due:** the due-check cohort is a known empty set. Render `0 of 0
   scheduled check targets`, `rate = null`; do not render “100% timely.” Current
   check coverage can still be non-zero because it is a different denominator.
3. **Paused source:** a paused scope remains in the configured-scope partition
   but is not in the active due harvest denominator. Both views appear together
   under the same registry revision.
4. **Duplicate revision:** a revision confidently matched to an existing
   canonical asset is in the `normalized` outcome. A candidate match awaiting
   review remains `pending` or `unknown`; neither is a normalization failure.
5. **Federal multi-state asset:** the asset counts once in global canonical
   inventory and can appear in multiple state-filtered cohorts. Each state view
   declares overlap; summing them would double count.

