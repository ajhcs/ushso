# Lane O3 — Question-to-Data Discovery Benchmark v0.1.0

## Status and control preamble

This is an offline benchmark and gold-plan package for the United States Health Systems Observatory product layer. External requests: **0**. It does not implement retrieval, acquisition, identity resolution, source downloading, or full-data analysis.

The shared product-layer controls applied here are: existing project records are the only source universe; source edits make benchmark evidence stale; catalog metadata is not proof of source-data custody or current accessibility; access, unresolved identity, stale freshness, and unavailable states remain typed; no identity merge is created; and no bundle receives join_proven without existing project proof. The package records evidence references rather than copying or rewriting the source records.

## Population and composition

Exactly 60 questions are included. Each question has a unique topic cluster and is assigned deterministically to development, validation, or held-out test. No near-identical paraphrase cluster is split across partitions.

| Geographic composition | Questions |
| --- | ---: |
| pennsylvania | 12 |
| national_federal | 12 |
| comparative_multi_state | 12 |
| other_state_locality | 12 |
| geography_ambiguous_or_independent | 12 |

| Expected response type | Questions |
| --- | ---: |
| multi_source_bundle | 24 |
| clarification_required | 10 |
| single_source | 18 |
| unsupported_or_incomplete | 8 |

The response types are gold behavior labels, not retrieval-engine outputs: single-source recommendation, coherent multi-source bundle, clarification before ranking, or explicit unsupported/incomplete abstention.

## Evidence boundary

The package references 36 existing project records: source-registry entries from discovery_financial_org/source_registry.json and asset-granular records from the Observatory rural-closure fixture. Registry entries retain their project status (including catalog_metadata_only, partial, special_access, and uncovered). Fixture records retain their explicit evidence, access, freshness, and candidate-join states.

Every positive and negative judgment carries source-record/family IDs, exact project-artifact locators, analytical grain/time/geography, access implications, and limitations. Negative judgments are not claims of corpus-wide absence; they are scoped reasons not to recommend a particular existing record for a particular question.

## Bundle design

Each multi-source question has required analytical roles, a minimum viable bundle, optional enrichment, join fields, crosswalk requirements, grain/geography/time/access compatibility, known gaps, and conditions that prevent recommendation. The package contains no join_proven bundle. Candidate joins remain candidate/crosswalk/incompatible/unknown according to the existing evidence boundary.

## Difficulty profile

The corpus covers conjunctions, exclusions, API/download alternatives, facility-versus-county grain, annual time windows, Pennsylvania scope, anonymous access, original-government authority, negative requirements, multi-hop closure/impact questions, ambiguous capacity/distress language, unsupported daily profitability precision, near misses, stale-source risk, public-metadata/private-data traps, and registry-versus-custody traps.

| Trap type | Questions |
| --- | ---: |
| public_metadata_private_data | 42 |
| registry_vs_custody | 21 |
| stale_source | 20 |
| facility_vs_system_grain | 12 |
| incompatible_time | 11 |
| county_vs_facility | 8 |
| ambiguous_language | 7 |
| near_miss | 7 |
| unsupported_precision | 7 |
| identity_ambiguity | 6 |
| proxy_as_measure | 5 |
| access_gate | 5 |

## Evaluation

The metric specification defines retrieval ranking metrics (Recall@1/@3/@5/@10, Precision@k, MRR, nDCG@k, essential-source recall, near-miss rejection), constraint handling, bundle quality, explanation/trust, and clarification/abstention measures. No system scores are reported in v0.1.0; evaluation is specification-only.

## Review and known gaps

The open human-review queue covers current endpoint/field verification, PHC4 and state-product access, IRS entity/perimeter semantics, CMS ownership event semantics, cross-state comparability, maternity-care support, capital-project coverage, and deliberate unsupported precision/claims/ownership cases. These items do not weaken the gold labels; they identify where the current index cannot responsibly support a stronger claim.

## Validation and prohibited actions

The validator is fixture-first and local-only. It checks exact counts, partition reconciliation, evidence-file existence, source-record existence, judgment completeness, bundle coherence, access-sensitive negatives, deterministic split leakage controls, manifest hashes, and prohibited-action flags. No external requests, live source refresh, heavy-analysis lock, identity merge, full-data job, or retrieval engine was used.
