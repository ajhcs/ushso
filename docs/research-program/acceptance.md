# Research-program acceptance contracts

Status: **unaccepted** for every requirement R01–R16.

This document is the C-002-2 measurable-row freeze. It preserves master-plan thresholds exactly. It does not accept any requirement, materialize conditional frames, or publish private holdout labels.

## Identities

- C-002-1 producer: `44506be8052e1054641048de68893fc41526b664`
- C-002-1 correction: `ef9c2569b78dd26f0436d2ea945a8e1b791b8698`
- Cohorts path: `evaluation/research-program/cohorts.json`
- Cohorts SHA-256 at this document's C2 write: `479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4`
- C1 historical cohorts SHA-256: `479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4`
- Tasks path: `evaluation/research-program/tasks.json`
- Tasks SHA-256: `35d9c03693b6575b1ca2743c6d2c38e8d5a4936a76f2e672718d918c5c2d0d58`
- Sealed evaluator manifest SHA-256: `142458d686e1cb5e9677b6a5eaa619955c78ef9a4d51735207d4ad19bf26c9ef`
- R14 protocol SHA-256: `3a35ee6662f939bf53e9f8c5005079ac09982372d80c9b385a9beb9c52e525c7`
- Generation: `live-2026-09-03-85b50522b420`
- Catalog manifest SHA-256: `85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e`

Hash scheme: SHA-256 of exact committed file bytes. `cohorts.json` and `tasks.json` do not contain their own digests. This document and the C2 receipt are destinations for those digests.

## Frame rule

A protocol, pointer, or unaccepted row is not a frozen or materialized measurement frame. Conditional frames stay unmaterialized until the named downstream PR writes identities, then independently freezes them before tuning or measurement.

## R01–R16

### R01 — Every catalog record is accounted for.

- **Master-plan threshold:** All 3,434 baseline IDs have a disposition; no silent loss. Each selected source run reconciles enumerated, accepted, unchanged, failed, restricted, and unresolved counts.
- **Denominator:** 3,434 frozen baseline record IDs from generation live-2026-09-03-85b50522b420.
- **Numerator / pass predicate:** Pass iff every baseline ID has a typed disposition and selected = succeeded + unchanged + failed + restricted + unavailable + unresolved + not_attempted, with no silent deletions.
- **Frozen identities or conditional frame:** Frozen C1 identity set. Source-run dispositions are a conditional frame until PR-020 materializes them.
- **Frame state:** `identities_frozen_dispositions_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-020 / PR-006 for isolated records; PR-002 C-002-1 for identity freeze.
- **Evidence destination:** evaluation/research-program/cohorts.json baseline_records; later source-run ledger from PR-020.
- **Materialize / freeze before tuning or measurement:** PR-020 must freeze complete dispositions before any coverage tuning that cites R01.
- **Status:** `unaccepted`

### R02 — Evidence labels are accurate.

- **Master-plan threshold:** Every public factual field has its source/revision and evidence state; inferred tags never become observed grain; freshness advances with the actual evaluation time.
- **Denominator:** Public factual fields on the accepted generation after PR-004/PR-005 contracts exist.
- **Numerator / pass predicate:** Pass iff 100% of those fields carry source/revision and evidence state, inferred tags are not observed grain, and freshness equals actual evaluation time.
- **Frozen identities or conditional frame:** Conditional field-evidence contract. Not frozen because this protocol/row exists.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-004, PR-005
- **Evidence destination:** packages/identity and coverage artifacts owned by those PRs.
- **Materialize / freeze before tuning or measurement:** Field-state contract and clock correction must be frozen before measurement that cites R02.
- **Status:** `unaccepted`

### R03 — Every record has a test disposition.

- **Master-plan threshold:** 100% have an eligibility decision and latest attempt or specific stop reason for metadata, documentation, API/file sample, and schema binding; not_attempted is not success.
- **Denominator:** 3,434 records × four axes (metadata, documentation, API/file sample, schema binding).
- **Numerator / pass predicate:** Pass iff every axis on every record has eligibility plus latest attempt or stop reason. not_attempted is not success.
- **Frozen identities or conditional frame:** Conditional attempt frame materialized by PR-020. C1 seeds source_run_disposition=not_attempted.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-020
- **Evidence destination:** PR-020 inventory/disposition artifacts.
- **Materialize / freeze before tuning or measurement:** Attempt ledger must be frozen before R03 measurement or routing.
- **Status:** `unaccepted`

### R04 — Core research sources are usable.

- **Master-plan threshold:** Frozen 100-product cohort has complete mandatory source cards. At least 80 publicly accessible products have a recent successful bounded sample and exact technical recipe; remaining cohort members have verified restricted/manual access routes. Record versions are not extra products.
- **Denominator:** 100 frozen product identities from C-002-1. Public-sample target uses the public-access subset of that same 100; it does not redefine the cohort.
- **Numerator / pass predicate:** Pass iff all 100 have complete mandatory source cards, at least 80 public-access members have recent successful bounded samples plus exact recipes, and every remaining member has a verified restricted/manual route. Shortfall is reported; the cohort is not quietly redefined.
- **Frozen identities or conditional frame:** Product identities frozen. Usability evidence is conditional until PR-042 after P5 intake.
- **Frame state:** `identities_frozen_usability_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-040, PR-042; P5 intake PR-043/044/045/054
- **Evidence destination:** evaluation/research-program/cohorts.json products; later source-card artifacts.
- **Materialize / freeze before tuning or measurement:** Do not retune the 100-product set to hit 80. Measure against this freeze.
- **Status:** `unaccepted`

### R05 — Variables mean something.

- **Master-plan threshold:** For every selected priority release, 100% of fields used in its example are bound to exact wire names, documented meaning, type state, unit or reasoned not-applicable state, allowed values/missingness where relevant, and provenance. Unknown optional fields stay visible.
- **Denominator:** Fields used in each frozen priority-product example after those examples exist.
- **Numerator / pass predicate:** Pass iff 100% of those example fields are bound as specified. Unknown optional fields remain visible rather than dropped.
- **Frozen identities or conditional frame:** Conditional example-field frame. Not materialized on C2.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-008, PR-017, PR-018, PR-041
- **Evidence destination:** variable/example artifacts owned by those PRs.
- **Materialize / freeze before tuning or measurement:** Example field sets must be frozen before R05 scoring.
- **Status:** `unaccepted`

### R06 — Broader extraction improves materially.

- **Master-plan threshold:** At least 95% of baseline records with publisher-accessible dictionaries yield a qualified parsed dictionary; the eligible denominator is explicitly evidenced. All other baseline records retain a reason and next action. This does not imply 95% of all fields have documented definitions.
- **Denominator:** Baseline records with an evidenced publisher-accessible dictionary. Extraction failure cannot be relabeled publisher absence.
- **Numerator / pass predicate:** Pass iff parsed / evidenced-eligible >= 0.95 and every ineligible/failed record has a reason and next action.
- **Frozen identities or conditional frame:** Conditional eligible-dictionary frame from PR-020/PR-018. Not frozen now.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-018, PR-020, PR-021
- **Evidence destination:** dictionary yield ledger from those PRs.
- **Materialize / freeze before tuning or measurement:** Eligible denominator must be frozen before yield measurement.
- **Status:** `unaccepted`

### R07 — Research retrieval is measured.

- **Master-plan threshold:** Current-generation, frozen present-source recall@10 >=0.90; judged precision@5 >=0.80; zero critical forbidden matches; separately report full-universe recall and source absence. Publish task-level failures and reviewer uncertainty.
- **Denominator:** Present-source recall: current-generation eligible present-source tasks/targets after versioned bindings. Precision: independently judged returned top-five items. Full-intention recall: all 49 fixed target slots across 40 tasks. Catalog 3,434 IDs are not this denominator.
- **Numerator / pass predicate:** Pass iff present-source recall@10 task-macro >= 0.90, blind judged precision@5 task-macro >= 0.80, and critical forbidden matches = 0. Report target/item micro alongside. Full-intention recall is reported for all 49 slots with no numeric threshold. Every returned top-five item has an independent blind judgment; any unresolved judgment blocks acceptance.
- **Frozen identities or conditional frame:** Public opaque 40-task index frozen (10 novice / 17 advanced / 13 machine; four per domain). Private labels remain inaccessible. Present-source eligible set is generation-specific and not fully materialized until later bindings.
- **Frame state:** `public_task_index_frozen_labels_inaccessible_present_source_conditional`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "evaluator_freeze_manifest_sha256": "142458d686e1cb5e9677b6a5eaa619955c78ef9a4d51735207d4ad19bf26c9ef", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md", "tasks_path": "evaluation/research-program/tasks.json"}`
- **Evidence owner:** PR-039 measures retrieval against this freeze; independent judges own labels.
- **Evidence destination:** evaluation/research-program/tasks.json; later PR-039 receipts.
- **Materialize / freeze before tuning or measurement:** Task index, scoring rules, and later present-source bindings must be frozen before retrieval tuning or measurement. Do not drop difficult tasks.
- **Status:** `unaccepted`

### R08 — Linkage is evidence-based.

- **Master-plan threshold:** At least 15 priority join routes, spanning facility and geographic linkage, have source/release/key context, cardinality checks, matched/unmatched denominators, temporal constraints, and limitations. Unsupported CCN=NPI and name-only equality are rejected.
- **Denominator:** A later frozen set of at least 15 priority join routes spanning facility and geographic linkage.
- **Numerator / pass predicate:** Pass iff >=15 routes have the required evidence and CCN=NPI and name-only equality remain rejected.
- **Frozen identities or conditional frame:** Conditional join-route frame. Not materialized on C2.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-034, PR-035, PR-036
- **Evidence destination:** join-route receipts owned by those PRs.
- **Materialize / freeze before tuning or measurement:** Join-route identities must be frozen before linkage scoring.
- **Status:** `unaccepted`

### R09 — Major coverage gaps are addressed.

- **Master-plan threshold:** Add the twelve named source families with supported identities/access routes and explicit data scope. A restricted source is useful as a verified route, without pretending to have its payload.
- **Denominator:** The twelve named families frozen by C-002-3 as intake pointers.
- **Numerator / pass predicate:** Pass iff each family has supported identity/access route evidence and explicit scope. Restricted payload retrieval is not implied.
- **Frozen identities or conditional frame:** C-002-3 publishes family pointers, candidate locators, and intake PRs. Actual source identities remain unverified locators until PR-043/044/045.
- **Frame state:** `conditional_until_C3_pointers_then_intake_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** C-002-3 pointers; PR-043, PR-044, PR-045 intake.
- **Evidence destination:** evaluation/research-program/cohorts.json expansion families; later intake artifacts.
- **Materialize / freeze before tuning or measurement:** Family set cannot be swapped for easier sources. Locators stay candidates until captured.
- **Status:** `unaccepted`

### R10 — MRFs are a real product layer.

- **Master-plan threshold:** Pilot directory covers 25 hospitals and 10 payer reporting entities from a frozen selection; every item has an evidence-backed locator/disposition. At least 20 hospital and eight payer entries have a successfully parsed bounded sample; no substitution of enforcement datasets for rate files.
- **Denominator:** 25 hospital candidate IDs and 10 payer candidate IDs frozen by C-002-3, retained even if unavailable, ineligible, or sharing a file. Parsed-sample targets remain >=20 hospital and >=8 payer of that same denominator.
- **Numerator / pass predicate:** Pass iff all 25/10 have locator/disposition evidence and >=20 / >=8 have successfully parsed bounded samples. Enforcement datasets cannot substitute. No silent replacement or deletion.
- **Frozen identities or conditional frame:** C-002-3 freezes candidate IDs/order/counts from the sealed directory selection. Locators, eligibility, file binding, and parsed samples are unresolved downstream bindings.
- **Frame state:** `ids_pending_C3_locators_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** C-002-3 IDs; PR-046/PR-049 locators; PR-047/048/050/051 parse; PR-054 qualification.
- **Evidence destination:** cohorts.json mrf_selection; later MRF receipts.
- **Materialize / freeze before tuning or measurement:** Freeze 25/10 IDs before any endpoint result. Later PRs consume them without replacement.
- **Status:** `unaccepted`

### R11 — Machine and human outputs agree.

- **Master-plan threshold:** All eight existing tools have positive and honest negative cases. For each priority example, IDs, release/schema context, field meanings, access state and citations agree across HTTP, MCP, WebMCP, and UI.
- **Denominator:** Eight existing tools plus later frozen priority examples.
- **Numerator / pass predicate:** Pass iff each tool has positive and honest negative cases and cross-surface fields agree on each priority example.
- **Frozen identities or conditional frame:** Conditional tool/example frame. Not materialized on C2.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-061, PR-063, PR-066
- **Evidence destination:** cross-surface receipts owned by those PRs.
- **Materialize / freeze before tuning or measurement:** Tool and example identities must be frozen before parity scoring.
- **Status:** `unaccepted`

### R12 — Beginners and experts can finish tasks.

- **Master-plan threshold:** Eight novice and eight advanced moderated participants, distinct from implementers, attempt a frozen set of tasks; >=85% completion in each group, no critical misinterpretation of access/grain/price semantics. Synthetic agent runs are separate evidence.
- **Denominator:** Eight actual novice participants and eight actual advanced participants, distinct from implementers, assigned to a frozen task/session map.
- **Numerator / pass predicate:** Pass iff completion >= 0.85 in each group and critical misinterpretation = 0. Missing sessions and untested tasks remain visible. Simulations and generated participants do not count.
- **Frozen identities or conditional frame:** Task pool is the frozen public opaque index. Participant identities, assignments, and success rules are a conditional frame that must be frozen before the study. Not materialized on C2.
- **Frame state:** `tasks_frozen_participants_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "evaluator_freeze_manifest_sha256": "142458d686e1cb5e9677b6a5eaa619955c78ef9a4d51735207d4ad19bf26c9ef", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-080
- **Evidence destination:** PR-080 study receipts; assignment freeze artifact before sessions.
- **Materialize / freeze before tuning or measurement:** Freeze participant-task assignments and success rules before the study. Do not drop untested tasks.
- **Status:** `unaccepted`

### R13 — Documentation is usable.

- **Master-plan threshold:** Beginner start, researcher workflow, developer/MCP setup, access, variables, joins, MRFs, uncertainty, citations, methodology, coverage, About and corrections guides exist, are cross-linked, and use tested examples.
- **Denominator:** The named guide set in the master-plan R13 row.
- **Numerator / pass predicate:** Pass iff every named guide exists, is cross-linked, and uses tested examples.
- **Frozen identities or conditional frame:** Conditional documentation set. Not materialized on C2.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-070, PR-071, PR-072
- **Evidence destination:** guide artifacts owned by those PRs.
- **Materialize / freeze before tuning or measurement:** Guide list cannot be shortened to pass.
- **Status:** `unaccepted`

### R14 — AI enrichment is controlled and economical.

- **Master-plan threshold:** No model in public request handling; no private data/credentials sent in enrichment; auditable token/spend ledger; 100% accepted model-derived claims pass citation and schema checks; held-out claim precision >=0.98, with zero critical scientific errors.
- **Denominator:** A later independently frozen scientific-claim sample drawn from the PR-020 residual frame. Not the 40 retrieval tasks. Sample size/CI design is chosen after that residual frame exists; the illustrative 149 iid count is not adopted.
- **Numerator / pass predicate:** Protocol row is complete when this protocol, stage order, and unaccepted gate are published. Quality pass later iff held-out claim precision >= 0.98, critical scientific errors = 0 overall and in every predeclared class, 100% accepted-claim citation/schema checks, with actual sample sizes, confidence intervals, and per-source/task-class results. Unjudgeable/uncertain outcomes block acceptance. Model agreement cannot create gold labels.
- **Frozen identities or conditional frame:** Protocol published. Residual frame, sample, labels, model outputs, spend ledger, and paid budget are not materialized. R14 gates promotion, not creation of the PR-027 comparison.
- **Frame state:** `protocol_published_not_materialized_not_frozen`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md", "r14_protocol_sha256": "3a35ee6662f939bf53e9f8c5005079ac09982372d80c9b385a9beb9c52e525c7"}`
- **Evidence owner:** C-002-2 protocol; PR-020 residual frame; PR-027 C1 target freeze; PR-022/023/024 controls; PR-027 C2/C3 measurement.
- **Evidence destination:** verification/research-program/pr-002/c2-r14-denominator-freeze-protocol-v2.md; later PR-020/PR-027 artifacts.
- **Materialize / freeze before tuning or measurement:** PR-027 C1 must freeze independent targets before comparison calls/results. Do not tune routing from unfrozen model outputs. Paid enrichment requires a selected budget and credentials; this commit does not call product models.
- **Status:** `unaccepted`

### R15 — Refresh is sustainable.

- **Master-plan threshold:** Two complete scheduled cycles and a 14-day observation window show bounded queues/spend/storage, timely refresh or explicit stale state, and no silent source loss. Alerts identify changed/actionable states, not routine success spam.
- **Denominator:** Two actual scheduled cycles and 14 actual elapsed observation days on the reviewed deployed product.
- **Numerator / pass predicate:** Pass iff both actual cycles and the 14 actual elapsed days exist and the operational bounds hold. Generated dates and simulated operation do not count.
- **Frozen identities or conditional frame:** Conditional operational window. No dates are generated here.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-076, PR-084
- **Evidence destination:** PR-084 observation record.
- **Materialize / freeze before tuning or measurement:** The window must actually elapse; it cannot be backfilled with synthetic timestamps.
- **Status:** `unaccepted`

### R16 — The final release is independently qualified.

- **Master-plan threshold:** Reproducible locked build, appropriate tests, current benchmark, actual browser/client journeys, capacity check, stage-to-production artifact identity, rollback rehearsal and post-deploy checks pass on the reviewed candidate.
- **Denominator:** The independently reviewed release candidate after prior requirements have evidence.
- **Numerator / pass predicate:** Pass iff each named gate passes on that exact candidate. This metadata freeze is not that candidate.
- **Frozen identities or conditional frame:** Conditional release-candidate frame. Not materialized on C2.
- **Frame state:** `conditional_not_materialized`
- **Source / generation identity:** `{"c1_cohorts_sha256": "479a5c33b8b54fa6a2673fdd17219dc52e8f36058fa3170538f1fa6696c156d4", "catalog_manifest_sha256": "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e", "generation": "live-2026-09-03-85b50522b420", "plan": "docs/master-plan/2026-09-10/MASTER-PLAN.md"}`
- **Evidence owner:** PR-079, PR-081, PR-082, PR-083
- **Evidence destination:** PR-082 release packet.
- **Materialize / freeze before tuning or measurement:** Qualify the reviewed candidate; do not substitute a different artifact.
- **Status:** `unaccepted`

## Public negative-case types

These types are documented from the PR packet and audit without exposing private tasks:

- HCRIS versus PHC4 reporting scope
- Maternal versus infant mortality substitution
- ACS geography grain/year confusion
- Nursing staffing source/grain confusion
- Price definitions: charge, negotiated rate, expected bill, utilization-weighted payment
- Forbidden joins: CCN=NPI and name-only equality

Holdout labels remain inaccessible to implementer tuning.
