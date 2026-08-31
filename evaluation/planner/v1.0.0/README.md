# USHSO planner benchmark and evaluator v1.0.0

This immutable WP10A package freezes the benchmark and evaluator contract that
must precede planner implementation. It is an offline evaluation artifact, not
planner runtime code. It neither retrieves source payloads nor executes an
analysis.

## Frozen population

Each of `development`, `validation`, and `held_out` contains 50 synthetic
questions. Twenty cases per split migrate the 60-case v0.1.0 discovery
benchmark. Thirty cases per split are synthetic contract-focused augmentations.
The held-out split therefore exceeds the plan's 30-case floor. Every held-out
safety-critical stratum has at least ten eligible cases.

Each split stores separately sealed JSONL artifacts for questions, statuses and
reason codes, roles, exact asset selections, measure bindings, operations,
requirements and blockers, coverage, acquisition DAGs, and clarifications.
`manifests/benchmark-manifest.json` hashes every component separately, including
all development, validation, and held-out gold.

## Evaluator boundary

`policies/evaluator-contract.json` freezes all twelve usefulness formulas,
numeric targets, tolerances, partial-credit rules, denominator units and floors,
plus the zero-tolerance safety rules. `tools/evaluator.mjs` implements those
formulas over normalized audit records. It reports aggregate numerators and
denominators overall and by stratum; it never emits question text or item-level
held-out judgments.

The evaluator refuses a held-out run unless a final-release authorization object
pins the release candidate, code, policy, evaluator, and threshold digests and
attests that no result has been used for tuning. WP10A validation deliberately
does not run held-out scoring.

## Privacy and leakage controls

All prompts are authored synthetic fixtures and are labeled `synthetic_only`.
No raw user question, user identifier, request identifier, IP address, or
transport telemetry is accepted or persisted. Production runtime code may not
import this package or its gold. The package validator scans the runtime roots
listed in `policies/runtime-leakage-policy.json` and fails on benchmark imports,
paths, package IDs, or benchmark-manifest digests.

The analysis-use v1 files were inspected but remain user-owned synthetic
conformance work whose truth boundary denies publication. Their observed hashes
are recorded only as excluded, informative provenance; they do not become gold
source truth or a runtime dependency.

## Governance gate

The implementation plan already fixes the numeric release targets. This package
freezes the remaining formulas and stratum floors. The three named owner roles
still must submit signed or reviewable evidence matching the pending state in
`governance/owner-ratification.json` before WP10B. The technical WP10A receipt
remains valid while truthfully recording that authorization as pending; it does
not impersonate product, research-methods, or engineering owners.

`governance/owner-review-packet.json` is the concise AUTH-12 review surface. It
contains every formula, target, floor, stratum, the three exact approval
digests, and exact attestation language, but no item-level held-out material.
After all three owners provide signed or reviewable evidence, an operator can
validate it and produce a separate authorization overlay without modifying this
frozen pending package:

```bash
node evaluation/planner/v1.0.0/tools/apply-owner-ratification.mjs \
  --evidence /absolute/path/to/wp10a-owner-approvals.json \
  --output /absolute/path/to/wp10a-owner-authorization.json
```

Run locally, with no network access:

```bash
npm test --prefix evaluation/planner/v1.0.0
npm run validate --prefix evaluation/planner/v1.0.0
npm test --prefix verification/wp10a/v1.0.0
npm run validate --prefix verification/wp10a/v1.0.0
```
