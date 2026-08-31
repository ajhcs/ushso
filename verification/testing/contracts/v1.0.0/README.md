# Contract and semantic test-strategy evidence v1.0.0

This private package maps every implementation-plan §22.1 bullet to exact, byte-pinned local contract evidence. `test` and `validate` are read-only and offline. Structural coverage can pass without release readiness: database referential integration, public runtime conformance, and planner authorization remain explicit blockers.

```sh
npm test --prefix verification/testing/contracts/v1.0.0
npm run validate --prefix verification/testing/contracts/v1.0.0
```
