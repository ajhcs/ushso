# ADR 0007: Versioned WP14 successor attestation

- Status: accepted for the bounded PR #8 successor
- Date: 2026-09-01

## Decision

WP14 fixture CAS hardening is attested additively as v1.1.0. The successor is
bound to implementation commit `f2641a3bfd5ae7249d0acffff883b312e4bdb077`
and tree `dc80d1c0f9ff7d8c4a2a4a8beb01ed2723878675` under explicit repository-owner
authorization.

WP14 v1.0.0 remains historical and byte-for-byte sealed. Its implementation
files and receipts are not repinned, overwritten, or reinterpreted. The
authorized CAS source and regression test move into the additive v1.1.0
package as exact Git blob copies. Bridge modules reuse the v1.0.0 fixture
state-machine foundation without changing that foundation.

The moving-checkout verifier selects the additive successor attestation when
the v1.1.0 policy exists and otherwise retains the legacy v1.0.0 verification
path.

## Authorization boundary

The owner authorized local code, tests, documentation, commits, push, and PR
#8 updates only. Deployment, provider mutation, production action, release-gate
execution, historical evidence mutation, and production-eligibility claims
remain forbidden.

## Consequences

This decision permits deterministic local and CI verification of the fixture
CAS change without converting it into authoritative transactional durability.
Managed durability, failover/PITR, recovery, canary, soak, release-gate, and
human evidence remain external blockers.
