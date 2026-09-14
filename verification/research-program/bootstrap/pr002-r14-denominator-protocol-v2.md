# Recommended C2 / R14 denominator-freeze protocol v2

**Disposition:** v2 is the corrected public recommendation requested by root. The initial v1 remains preserved at SHA256 `f0805d63c6666bd2c24a4765fcab02b1b38c2c6c641fa349e42d5575725c8794`. Root sealed the evaluator inputs at `2026-09-10T18:09:09.407077+00:00` with disposition `accepted_as_frozen_evaluator_inputs`; this protocol does not establish R14 acceptance. This document creates no labels, tasks, provider calls, paid budget, or acceptance result. Validation timestamp: `2026-09-10T18:25:45.101068077Z`.

## Separate the inputs and gates

The sealed 40-task manifest (SHA256 `142458d686e1cb5e9677b6a5eaa619955c78ef9a4d51735207d4ad19bf26c9ef`) is an R07 retrieval input: 40 tasks and 49 task-target slots. It is not complete R14 scientific claim gold.

R14 needs a separate held-out scientific claim sample drawn after PR-020 C-020-3 produces its residual manifest. C2 can and should publish this denominator protocol now. C2 cannot require PR-020 execution or future model results as if they already existed. Actual residual-population materialization, deterministic sample freeze and eventual R14 measurement are later gates required before PR-027 comparison, tuning or promotion. Protocol definition, materialized denominator and measured evaluation pass are separate states.

**Unresolved input:** the PR-020 residual manifest and eligible scientific target population are not yet materialized. No R14 sample, labels, confidence intervals or complete current scientific gold may be claimed.

## Protocol to freeze after PR-020

1. Hash-bind the complete PR-020 residual manifest, generation, disjoint dispositions and eligibility rules. Define the R14 target population, claim classes and strata from that artifact. Strata should preserve source family/release, claim type, native field or definition role, unit/grain, geography/time role and evidence/access state as applicable.
2. Predeclare a deterministic sampling specification: algorithm version, seed, per-stratum counts, canonical tie-break and immutable source/evidence/native-field context. A reproducible ordering may hash `seed`, source-native record identity, native field and evidence hash. Selection must not use provider outputs, result ranks, model agreement or review outcomes. Freeze the resulting sample manifest, source-grounded label rubric/decisions and receipt before any provider outputs or comparison-driven selection, routing or tuning.
3. Predeclare the exact candidate model IDs/endpoints and external budget owner separately. Their predeclaration is allowed; it does not let a provider output select the sample or alter labels, routing or tuning after the freeze. No private data or credentials may be sent in enrichment. This protocol authorizes no paid inference.
   Implementer delegation and any paid-product enrichment remain separate authorized workstreams and do not alter this evaluator freeze; models remain out of public request handling.
4. Keep sampling and label adjudication blind to provider outputs; mask provider identity and randomize output order for independent judges where feasible. Model-generated labels and inter-model agreement are not gold.
5. Retain every sampled outcome: accepted claim, non-critical error, critical scientific error, abstention, unjudgeable result, unavailable evidence and coverage failure. Report emitted claims, accepted claims, abstentions, unjudgeable cases and coverage by class and overall.

Use the R14 point precision requirement `>=0.98`, zero critical scientific errors overall and in every predeclared class, and 100% citation/schema/native-field checks for accepted model-derived claims. Report point estimates, sample counts and predeclared confidence intervals. The CI and sample-size design must be chosen after the residual frame exists and must account for source/record clustering, finite population and disproportionate stratification; an iid one-sided shortcut or a fixed per-class count is not adopted automatically here. Record underpowered classes and unresolved judgments; do not convert them into a pass.

Any earlier 149-observation zero-error calculation is an iid/one-sided Clopper–Pearson illustration only. It is not an adopted per-class threshold and does not automatically cover clustered records or disproportionate strata.

Claim precision and coverage remain distinct. Precision must state its emitted-claim denominator and how unjudgeable claims are handled; an emitted but unjudgeable claim is not accepted and remains in the conservative denominator or an explicitly unresolved bucket, and abstention does not become a correct claim. Coverage, abstention and unjudgeable rates remain visible, so precision from near-zero output cannot establish useful model selection.

## C2 acceptance row and later R14 gate

The recommended `C-002-2 / R14 denominator freeze` row is complete when C2 publishes: (a) this protocol and its versioned metric/denominator definitions; (b) the exact R14 target-population contract, evidence owner and unresolved PR-020 prerequisite; (c) the separation from the sealed 40 retrieval inputs; (d) the deterministic sampling, blindness, outcome-retention and CI/design requirements; and (e) the rule that no provider output or model agreement can change the frozen sample. C2 records a protocol readiness result, not an R14 quality result.

Before PR-027 comparison or promotion, a later receipt must prove the hashed PR-020 residual manifest, materialized deterministic sample, frozen labels, blind adjudication and retained outcomes. Only that later evaluation can report whether the R14 gate is met: point claim precision `>=0.98`, zero critical scientific errors per class and overall, complete citation/schema checks for accepted claims, confidence intervals, coverage and auditable token/spend and review ledger. A missing residual manifest, missing class, unjudgeable outcome or underpowered design is an unresolved later gate.

## Source anchors

- `docs/master-plan/2026-09-10/MASTER-PLAN.md`, R07 line 37 and R14 line 44, SHA256 `eaa8adc671eb44c176ff899f2ee138ec6f2e420444170c32ff757bac9a716aff`.
- `docs/master-plan/2026-09-10/EXECUTION.md`, model-evaluation guidance line 88, SHA256 `4118d4f46a7ebec45749676881c753529593842792a439cfb5e53e50bc1fdfc3`.
- `docs/master-plan/2026-09-10/prs/PR-020.md`, C-020-3 line 39, SHA256 `7b1d4f5426a2ad0992a65d0fe1fa38ee781fbc19857d2f9aa69b37014005e147`.
- `docs/master-plan/2026-09-10/prs/PR-027.md`, C-027-1 line 27 and C-027-3 line 39, SHA256 `e80a853a8af2f109cce0b33e51c2ad741675b7a4dbbb4377d7052368cd61259d`.
