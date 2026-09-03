# USHSO WP2 aggregate verification v1.0.0

This package is the fail-closed completion receipt for the WP2 contract freeze.
It verifies these ten required artifacts as one coherent boundary:

1. `contracts/tooling/v1.0.0`
2. `contracts/core/v2.0.0`
3. `contracts/ingestion/v1.0.0`
4. `contracts/identity/v1.0.0`
5. `contracts/publication/v1.0.0`
6. `contracts/coverage/v1.0.0`
7. `contracts/research-plan/v1.0.0`
8. `contracts/machine-toolkit/v1.0.0`
9. `evaluation/harness/v2.0.0`
10. `evaluation/bridge/v1.0.0`

The registry is frozen in `contracts/package-registry.json`. Missing packages,
receipts, manifests, tests, schemas, scripts, or semantic pins fail the gate.

## Independent checks

The aggregate does not trust a package merely because its own validator exits
successfully. It independently:

- samples every `package.json`, package manifest, and stored receipt three times
  and requires all release-pin hashes to be present and stable;
- inventories every `*.schema.json`, requires Draft 2020-12, compiles it with
  strict Ajv 2020, and submits the same unexpected-property fixture to every
  root object schema;
- requires at least one declared Node test case and parses a nonzero test count
  from every public `npm test` result, preventing an unfinished empty suite from
  passing;
- verifies every listed manifest byte count and exact SHA-256 digest;
- records manifest/receipt byte-and-metadata state before and after every public
  command and across the complete 20-command run, and fails if any test or
  validator rewrites its own or another package's sealed artifact;
- distinguishes contract raw-byte and canonical-JSON digest taxonomies;
- checks stored receipts and zero-action boundaries;
- cross-checks the evidence-state ladder, evidence identifiers, access classes,
  coverage-cell states, plan statuses, truth boundary, and publication/index/
  registry/coverage pins across core, identity, coverage, publication, planner,
  and machine-tool contracts;
- pins the evaluator metric contract, benchmark, present-source policy, cohort,
  algorithms, and bridge receipt, and proves they remain `FAIL_PRE_TUNING` with
  no benchmark mutation or ranking optimization.

## Receipt-safe command execution

Each required package's public commands are executed:

```text
npm test --prefix <package>
npm run validate --prefix <package>
```

The verifier first copies the repository, excluding `.git` and `node_modules`,
to a unique temporary directory and links the installed dependency tree there.
Commands run only in that mirror. Exact source-package and receipt-tree hashes
are recorded before and after all 20 commands; any mutation or concurrent edit
fails the gate. The temporary directory is removed after execution.

The aggregate makes zero network requests, runs no analyses, performs no source
payload access or identity merges, deploys nothing, and changes no source
package receipt.

## Commands

After all ten packages are complete and stable:

```sh
npm run manifest --prefix verification/wp2/v1.0.0
npm test --prefix verification/wp2/v1.0.0
npm run validate --prefix verification/wp2/v1.0.0
npm run receipt --prefix verification/wp2/v1.0.0
```

The final command writes `validation/validation-receipt.json` only when the
aggregate receipt itself satisfies its strict schema. A failing preliminary
audit or malformed aggregate receipt is printed and is not promoted.
