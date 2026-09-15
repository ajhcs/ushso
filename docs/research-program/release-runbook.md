# Release runbook

Status: **R16 fail**. Release is **not qualified**. This packet does not change production.

Last-good generation remains `live-2026-09-03-85b50522b420`.

## Immutable captured candidate

- Head: `8e7520c807668e42ec5daf9313b493bf1dd6fcf8`
- Tree: `7562df6cba965f450d27d4149fd62c0690ae99ec`
- Local gate: `20260915T072218Z-781fcf0b2216` verdict `passed` (550.69s)
- Receipt pointer: `verification/research-program/release/candidate-capture.pointer.json`
- Full 21 MiB receipt stays off-tree. Do not copy it into git.
- A rebuild creates a **new** candidate. Old approvals and receipts cannot be copied onto changed bytes.

Pins:

- Node engines: `>=22.15.0`
- npm engines: `>=11.19.1 <12`
- packageManager: `npm@11.19.1`
- `package-lock.json` sha256 `7001c1d478ff1468464abe40990ff183f639fc60e769e20a0189638878f4d3a3`
- `.codex/release-gate.toml` sha256 `068273993ddb6692eb5ac77a07d9ab7a10a5ee670efdf3b236ba1064de297478`

Declared local-gate stages on this exact subject: preflight, bootstrap (`npx --yes npm@11.19.1 ci --ignore-scripts`), dependency-tree, tests, build, local-e2e, release-audit, cloudflare-dry-run, retain-deployable-artifacts, receipt. Skipped checks are **not** passes.

## Staging

AUTH-01, AUTH-02, and AUTH-03 remain `not_requested` and `authorized: false`. Staging deploy was **not** performed. Data/API/browser/crawler/client acceptance against a staged target remains **unverified**. This is not a staging pass.

## C-009-1

Measured cheapest topology remains **unresolved**. Required facts (actual account terms, shared allowances, measured steady/burst workload and cost, storage/transfer, unchanged rights/capacity/recovery) are absent. Public prices and publication asset lengths are insufficient. Unresolved required qualification is **rejected**, not counted as full acceptance because engineering PRs merged.

## R01–R16

All sixteen requirements remain unaccepted. The release evidence includes those statuses. Independent reviewer identity for this engineering packet is Astra/root. A named human scientific/owner reviewer is **absent**. R16 result is **fail**.

## Concrete decision

- Release qualified: **no**
- Proceeds to production: **no**
- Public traffic / paid resource / secret change: **no**
- Rollback target if a later authorized change occurs: historical production Worker `ecc1603f-9eb4-4a1b-a566-bd9d7a415de4` (2026-09-09). This packet does not change it.

HTTP 200 is not a completed research task. A passing schema is not scientific approval.
