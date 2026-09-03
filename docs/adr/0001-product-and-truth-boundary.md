# ADR 0001: Product and truth boundary

- **Status:** Accepted
- **Decision date:** 2026-08-30
- **Decision owners:** Product, Research UX, Planner, API, Web, Security, Data
- **Accountable approver role:** Product owner
- **Acceptance basis:** Authoritative plan-execution directive dated 2026-08-30
- **Implementation state:** `in_progress`
- **Supersedes:** None
- **Superseded by:** None

## Mapped requirements and tests

| Source | Requirement or test |
|---|---|
| Plan | §§1, 3–5, 12–16, 17.3–17.4, 20 (WP0, WP2, WP10–WP12), 23.2, 23.4, 23.7–23.8, 25, and 28 |
| Tester requirements | TST-COV-01, TST-PLAN-01, TST-FIT-01, TST-TRUST-01, TST-MCP-01, TST-MCP-03, TST-MCP-04, TST-MCP-05 |
| Acceptance tests | `product-boundary.contract`, `planner-safety`, `scope-language`, `coverage-positioning.contract`, `machine-toolkit-zero-action`, `machine-interface-parity`, `query-privacy.redaction`, `public-authoritative-egress-deny` |

## Context

USHSO is a public-source metadata observatory and research navigator. It helps a
researcher identify suitable sources, understand why they fit, select exact
releases and access routes, and compile a defensible acquisition and
transformation plan. The value depends on preserving the boundary between
evidence-backed guidance and analysis or access execution.

Catalog visibility is not payload access; describing an authorization process is
not granting authorization; and naming a possible join is not proving
compatibility. Coverage is incomplete by design and must be scoped to a source
universe, publication generation, denominator, and observation time. These
distinctions must survive every human and machine surface.

## Decision

### Supported jobs

USHSO exposes exactly three product jobs:

- **Browse** returns indexed sources, assets, releases, distributions, facets,
  families, and scoped coverage without inferring a research objective.
- **Discover** returns bounded, ranked, evidence-backed candidates and explicit
  near misses without presenting a ranked list as a research design.
- **Plan** compiles the smallest defensible evidence bundle, compatibility
  assessment, ordered acquisition instructions, and non-executed downstream
  handoff without performing the analysis.

### Allowed data and behavior

USHSO may store and serve bounded catalog metadata, documentation, schema and
field descriptions, access observations, source-native evidence captures,
canonical assertions, typed relationships, and derived non-authoritative search
projections. It may explain:

- source roles, fitness, limitations, provenance, and observation time;
- exact releases, distributions, technical retrieval procedures, and human
  authorization gates;
- joins, crosswalks, aggregation, filtering, temporal alignment, and measure
  harmonization that a researcher would need to perform;
- known compatibility, requirements, blockers, uncertainty, and unsupported
  downstream work.

The public request path reads a pinned published view. It never harvests a
source, retrieves a source payload, mutates identity, or satisfies an external
authorization requirement.

### Prohibited data and behavior

USHSO must not:

- download, proxy, host, inspect, profile, or return underlying healthcare data
  rows or user-provided datasets;
- submit registrations, accounts, applications, DUAs, fees, logins, or other
  human/institutional authorization steps;
- execute joins, crosswalks, aggregation, harmonization, calculations, SQL,
  notebooks, or analytical workflows;
- calculate or return measures, market share, financial benchmarks, rankings,
  trends, forecasts, charts, or analytical results;
- claim a universal provider identity, silently merge uncertain entities, or
  convert family membership or join compatibility into identity equality;
- claim exhaustive national, jurisdictional, or source coverage without a
  complete named inventory denominator;
- treat visibility, a public landing page, or public metadata as proof that a
  payload is freely accessible;
- persist raw question text or user identifiers in operational telemetry by
  default.

User uploads, analysis workspaces, notebook/SQL environments, dashboards, and
chart builders are outside the product. A future proposal to add any prohibited
behavior requires a successor ADR, an explicit product decision, a new security
and privacy model, and separate contracts; it cannot be introduced as planner
or UI polish.

### Common truth-boundary envelope

Every public JSON API, WebMCP, and canonical plan response declares these
contract fields with the stated meanings:

| Field | Required value | Meaning |
|---|---:|---|
| `source_requests_made` | `false` | The request made no call to an authoritative source endpoint. |
| `execution_authorized_by_ushso` | `false` | USHSO did not grant or satisfy an external access requirement or authorize execution. |
| `retrieval_executed` | `false` | No Retrieval Recipe was executed against an authoritative source. |
| `payloads_acquired` | `false` | No underlying source-data rows, files, or payload bodies were acquired or returned. |
| `analysis_executed` | `false` | USHSO computed no statistics, measures, joins, comparisons, rankings, or analytical result. Metadata comparison and plan compilation are not analysis execution. |
| `identity_merges_performed` | `false` | The request did not mutate the canonical identity graph. Reading an accepted assertion is not a merge. |

Human pages communicate the same boundary in maintained copy linked to the
contract/policy version. Documentation and `llms.txt` are discovery/bootstrap
material, not executable interfaces. Shared service methods supply the facts;
adapters do not invent different meanings.

### Evidence, unknowns, and scoped absence

Every public truth-bearing claim references evidence and observation time.
Access state separates visibility, payload access, requirements, authorization,
and infrastructure outcome. `unknown`, `missing`, `failed`, `blocked`, `stale`,
`excluded`, and `not_assessed` remain distinct where the applicable contract
defines them.

A zero result means only that no eligible object matched in the named immutable
generation and query scope. It cannot be rendered as proof that no source or
asset exists. The public coverage position remains “14-source,
live-metadata-validated federal baseline plus selected state coverage” until a
verified coverage snapshot supports a successor statement.

### Enforcement points

The boundary is enforced in strict contracts, semantic validators, database
roles, connector capture policy, public Worker bindings, service return types,
copy audits, test fixtures, egress-deny checks, structured telemetry allowlists,
and release receipts. Any prohibited payload, action, claim, or raw-query
persistence fails closed and blocks publication.

## Alternatives considered

### General analytics application

Rejected. It would require handling source data, new privacy and authorization
obligations, open-ended computation, and result-validation semantics unrelated
to USHSO's evidence-navigation mission.

### Automatically acquire public or registered data

Rejected. “Public” is not a stable access guarantee, and registration, DUA,
payment, identity, and institutional gates require human authority that USHSO
does not possess.

### Provide joins or summary calculations as a convenience

Rejected. Executing even apparently small calculations erases the clear
metadata/analysis boundary and invites unsupported market-share, benchmark, and
quality conclusions.

### Rely on disclaimers instead of contract fields and controls

Rejected. Prose alone cannot guarantee parity across UI, API, WebMCP, logs, or
future adapters and cannot prove zero source egress or execution.

### Collapse missing and failed observations into `not_found`

Rejected. It turns pipeline uncertainty into a false source-absence claim and
corrupts public coverage accounting.

## Consequences

- Plans are handoffs a researcher can execute elsewhere, not workflows USHSO
  executes.
- Metadata comparison is supported; analytical comparison of source data is not.
- Source capture, output schemas, and logs need allowlists and negative fixtures,
  not merely best-effort filtering.
- Researchers encounter explicit human gates and unresolved gaps instead of a
  misleading “ready” state.
- Some desirable user requests must be answered with an unsupported or
  constrained plan rather than a computed result.
- Product copy and machine responses must be tested together because either can
  overstate scope, access, identity, or completeness.

## Compatibility and rollout

Existing discovery behavior remains available through repository adapters while
successor contracts add explicit pins and truth fields. Existing v1 contract
artifacts remain immutable. New plan and machine-toolkit surfaces cannot be
publicly enabled until their boundary, redaction, egress, parity, and safety
tests pass. Static fallback retains the same non-goals.

## Implementation and verification

| Control | Owner | State | Receipt target |
|---|---|---|---|
| Decision and non-goal invariant | Product + Architecture | implemented | `verification/wp0/v1.0.0/receipts/product-boundary-adr.json` |
| Strict boundary contract and adversarial fixtures | Contracts + Security | not_started | `verification/wp2/v1.0.0/receipts/product-boundary-contract.json` |
| Planner claim/safety enforcement | Planner + Security | not_started | `verification/wp10/v1.0.0/receipts/planner-safety-gate.json` |
| UI/API/WebMCP semantic parity | API + Web + Machine interfaces | not_started | `verification/wp12/v1.0.0/receipts/machine-interface-conformance-manifest.json` |
| Zero authoritative egress/action and telemetry redaction | Security + Platform | not_started | `verification/wp12/v1.0.0/receipts/machine-toolkit-egress-redaction.json` |
| Scoped coverage and absence language | Product + Data | not_started | `verification/wp9/v1.0.0/receipts/generation-copy-audit.json` |

## Unresolved and externally authorized work

There is no unresolved product-boundary decision. Human reviewer policy for Use
Cards and Access Plans must be fixed before public plan beta, but it cannot relax
this boundary. Deployment, production data migration, source allowlisting, and
any future capability that performs acquisition or analysis require explicit
authorization outside this ADR.
