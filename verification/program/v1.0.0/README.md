# USHSO implementation evidence ledger

This mutable control ledger tracks the authoritative implementation plan at the
work-package, test-strategy, release-gate, migration-stage, Definition-of-Done,
and tester-requirement levels. It is a tracker, not a substitute for receipts.

A control can be marked `verified` only after the named receipt exists and its
verification passes. Time- or production-dependent controls remain pending
until their local implementation is complete and the exact external
authorization boundary has been reached.

Run:

```bash
npm test --prefix verification/program/v1.0.0
npm run validate --prefix verification/program/v1.0.0
npm run receipt --prefix verification/program/v1.0.0
```
