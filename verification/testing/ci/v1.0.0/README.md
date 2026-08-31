# Research Navigator CI verification v1.0.0

This package seals the fail-closed CI and package-discovery configuration for WP2. It is an offline verification package: it reads repository metadata, discovers versioned packages and Node tests, and verifies the stored receipt. It does not run source harvests, deploy or apply infrastructure, access secrets, update another package's receipt, or make network requests.

The root runner dynamically discovers every `contracts/<domain>/v<semver>` package, including the machine toolkit. Contract packages must be private, match their directory version, expose direct Node `test` and read-only `validate` scripts, contain no hidden pre/post lifecycle hooks, and contain at least one discovered `*.test.{js,cjs,mjs}` file. A successful execution also requires the Node test runner to report a parsed test count greater than zero. Child npm processes receive isolated empty user/global npm configuration and a scrubbed environment.

The aggregate additionally selects the latest compatible evaluator-v2, bridge, feedback, WP0, WP2, program-ledger, external-authorization, and CI-verification packages. It invokes only their declared read-only test/validation scripts. WP0 and WP2 must return PASS; blocked, skipped, or expected-failure states fail CI. The build job runs `npm run build` once and then `cf:dry-run:artifact`; the public `cf:dry-run` command remains a build-plus-dry-run compatibility wrapper for local use.

Child output is routed through mode-0600 files in a unique operating-system temporary directory so nested Node test output remains observable under sandboxed `spawnSync`. The runner enforces a 64 MiB combined limit and removes the directory after each script. It accepts the known sandbox-only `EPERM` anomaly only when a numeric exit status is exactly zero; signals, timeouts, missing statuses, other spawn errors, and nonzero exits still fail.

One legacy fixture test, `contracts/core/v1.0.0/tests/core-contract.test.mjs`, itself calls `execFileSync` to prove deterministic fixture builds. The Codex workspace sandbox can reject that nested process with `EPERM` even when the returned status is zero. The package deliberately does not bypass, skip, or reinterpret this test: a complete local receipt must rerun `npm run test:contracts` in an authorized environment that permits nested process creation. GitHub Actions is not expected to exhibit this sandbox-specific condition.

The package also audits `package-lock.json` structurally. Lockfile version 3, the root workspace patterns, every workspace package identity and dependency map, and every npm workspace link must match the checked-in package metadata; stale, missing, or duplicate workspace links fail closed.

The stored receipt excludes runtime timestamps and is deterministic. Normal CI runs only:

```sh
npm test
npm run validate --prefix verification/testing/ci/v1.0.0
```

`npm run receipt --prefix verification/testing/ci/v1.0.0` is an explicit maintainer operation used only when this CI contract intentionally changes. It writes only this package's receipt and is never called by the aggregate or GitHub Actions.
