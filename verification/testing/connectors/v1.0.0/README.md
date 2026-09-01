# Connector test-strategy evidence v1.0.0

This private package maps every implementation-plan §22.2 bullet to exact, byte-pinned local evidence. Local parser, adapter, playback, fault, and target-class fixtures are distinguished from the AUTH-04 live metadata smoke, shadow, and source-canary work that has not occurred. `test` and `validate` perform no source calls or repository writes.

```sh
npm test --prefix verification/testing/connectors/v1.0.0
npm run validate --prefix verification/testing/connectors/v1.0.0
```
