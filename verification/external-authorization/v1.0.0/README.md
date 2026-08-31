# External authorization register

This register names external actions that the implementation cannot perform
without explicit, candidate-specific authorization. An entry is a blocker
record, never permission. Local code, contracts, fixtures, dry runs, and
rehearsals should be completed before an entry is presented for approval.

The fifteen entries keep procurement, secret/control-plane creation, staging
apply, zero-traffic production-foundation apply, live source egress, recovery
drills, protected canary, public cutover, soak, JSONL retirement, remote Git
publication, planner-governance ratification, independent retrieval-holdout
custody/final evaluation, identity adjudication, and coverage-copy ownership as
separate authorization decisions.

The ordered request packets and the release-gate candidate reconciliation are
documented in
[RELEASE_GATE_AND_AUTHORIZATION_RECONCILIATION.md](../../../docs/RELEASE_GATE_AND_AUTHORIZATION_RECONCILIATION.md).
They remain request-ready, not self-authorizing evidence.
