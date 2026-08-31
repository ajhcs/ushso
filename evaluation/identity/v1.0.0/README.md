# Identity evaluation v1.0.0

This package seals an adjudication-ready benchmark shape for WP7. Six
launch-critical strata each contain 50 positive pairs, 50 hard negatives, and
20 temporal/reuse/conflict cases. The hard negatives include parent, campus,
system, entity, and grain boundary cases.

The records are deterministic synthetic conformance fixtures. They contain no
source payloads and are **not** human adjudication. Reviewer slots and labels are
null. The case lifecycle marker `pending_external_double_review` does not grant
permission to start review: the governing step is
`pending_external_authorization`. `AUTH-14` is currently `not_requested` and
`authorized:false`; it only records the future authorization/coordination
boundary. The external adjudication schema requires identified humans and
independence/identity receipts; controlled fixtures are excluded from agreement,
kappa, and production enablement denominators.

`adjudication/reviewer-packet.json` and `REVIEWER_INSTRUCTIONS.md` define the
digest-bound blinded review process. Reviewer case IDs are opaque, and reviewer
payloads omit internal case IDs, sealed case classes, scenario names, synthetic
expectations, and algorithm decisions. The bounded offline import validator
requires distinct reviewers, resolves disagreements only through a third
distinct adjudicator, reports agreement/kappa and every stratum, and emits no
ready-for-import receipt while AUTH-14 remains unauthorized.

The evaluator reports candidate recall, false automatic merges, unresolved and
review rates, double-review agreement, Cohen's kappa, per-stratum denominators,
and reversal integrity. Every production rule remains
`disabled_candidate_only`; passing synthetic fixtures is never an enablement
decision. Candidate-only release does not require future automatic resolution;
an authorized enablement receipt is required only if a rule is later promoted.

Offline commands:

```sh
npm test --prefix evaluation/identity/v1.0.0
npm run evaluate --prefix evaluation/identity/v1.0.0
npm run validate --prefix evaluation/identity/v1.0.0
npm run export-reviewer-packet --prefix evaluation/identity/v1.0.0
npm run validate-adjudication --prefix evaluation/identity/v1.0.0 -- /absolute/path/to/submission.json
```

Both `evaluate` and `validate` verify the immutable artifact manifest,
validation receipt, benchmark case seal, and null/zero external-review fields.
