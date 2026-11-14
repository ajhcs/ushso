# Source-selection operations

Development runs on Builder Bob in the implementation checkout. The November 13
technical release and subsequent Cloudflare fixes have their own retained
production receipts. The November 14 publication/AI follow-on is a separate
engineering change; its source and AI gates remain closed. The recovery checkout
and historical receipts remain separate. Start with
`docs/source-selection/ENGINEERING-2026-11-14.md` and the approval packet.

## Build and local qualification

Use the committed npm lockfile, Node >=22.15 and npm >=11.19.1 <12. Keep local
builds, caches and temporary files on the verified `/workspace` filesystem.
The historical default research archive location is on Plumbob; on Builder Bob
set `USHSO_RESEARCH_ASSET_SOURCE` to an existing local archive. The preparation
script verifies its committed size and SHA-256 before use. Do not bypass that
check or copy arbitrary pending research bytes into public assets.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
npm run cf:dry-run
node scripts/release-source-selection/check-local-integration.mjs
USHSO_BROWSER_SKIP_BUILD=1 npm run test:e2e:browser
```

Provide an absolute writable `TMPDIR`. CI uses its runner-owned temporary
directory where supported. Browser installation in CI is separate from host
administration. A browser screenshot or passing HTTP check does not establish
scientific adequacy or production identity.

## Accepted publication

Candidate inventory in `data/source-selection` contains no accepted assertions.
It is useful for review preparation but must not be promoted merely because it
validates. The user designated Luis Barrigan, Syed Siddiqi and Cole Lyons as
source reviewers. Capacity, source-specific decisions and completed reviews
remain unrecorded.

Use `scripts/source-selection/local.mjs` for local ledger commits, rights policy,
publication and readback. Follow `contracts/source-selection/README.md` and
`packages/source-selection` for exact command arguments and schemas. Retain
review identities, exact claims, evidence hashes and decisions. Review must
establish source meaning; byte-span validation cannot do that.

Set `USHSO_SOURCE_SELECTION_LEDGER` only to a reviewed local ledger for a build.
The build otherwise emits an explicit unavailable publication. Serving accepted
data additionally requires the trusted `USHSO_ACCEPTED_RIGHTS_HASH` to match its
rights policy. This binding is operational configuration, never request input.
No such production setting was created by this implementation.

Rights changes require an updated trusted policy and a corrective publication.
The static Worker does not independently discover publisher revocations. Check
expiry and current permissions before distribution or restoring any old bundle.
Retain permitted audit history while removing or quarantining prohibited bytes
under the applicable decision. User-downloaded copies cannot be recalled.

## Recovery and support

Never delete a writer lock because it looks old. The explicit recovery command
checks the expected lock hash, host, boot identity, process liveness and referenced
artifacts. Preserve staging and recovery receipts. Tested killed-writer boundaries
do not prove resilience to every filesystem or power failure.

Restore application, static assets, catalog and compatible policy together.
Reject a retained bundle whose current rights no longer permit distribution.
The former Plumbob origin, tunnel and DNS are not a verified fallback until an
authorized rehearsal establishes their present behavior. This candidate does
not modify that infrastructure.

Private security reports use the existing published `info@ushso.org` contact.
No response interval is promised until staffing is established. Keep research
questions, personal notes, credentials and restricted data out of routine logs.
Shortlist persistence is optional device-local storage; imports remain unverified.

## Local retained-byte restore rehearsal

Freeze the completed build before retention; do not run another build while its
files are being inventoried. The local rehearsal retains every file in
`apps/web/dist`, the actual bundled `.wrangler-dry-run/index.js`, and a minimal
local Wrangler configuration. It preserves the compatibility date/flags and the
six allowlisted scientific/dictionary feature variables from `wrangler.jsonc`.
It excludes deployment accounts/routes, remote bindings, custom build hooks and
secrets. Production traffic is never switched.

Run from the candidate checkout after `npm run cf:dry-run` succeeds. Choose a
fresh parent directory on verified `/workspace`; the retained, restored and
runtime directories must not already exist. Allow space for two copies of the
built assets (currently approximately 2.7 GB combined). Keep the retention
receipt outside the retained directory as the expected inventory identity.

```sh
set -e
LOCAL_RELEASE_ROOT=/workspace/build/builderbob/ushso-restore-rehearsal-20261114
mkdir "$LOCAL_RELEASE_ROOT"
node scripts/release-source-selection/restore-release.mjs retain \
  apps/web/dist .wrangler-dry-run/index.js \
  "$LOCAL_RELEASE_ROOT/retained" wrangler.jsonc \
  > "$LOCAL_RELEASE_ROOT/retention-receipt.json"
RELEASE_INVENTORY_SHA256=$(node --input-type=module -e \
  'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1])).inventory_sha256)' \
  "$LOCAL_RELEASE_ROOT/retention-receipt.json")
node scripts/release-source-selection/restore-release.mjs restore \
  "$LOCAL_RELEASE_ROOT/retained" "$LOCAL_RELEASE_ROOT/restored" \
  "$RELEASE_INVENTORY_SHA256"
node scripts/release-source-selection/restore-smoke.mjs \
  "$LOCAL_RELEASE_ROOT/restored" "$PWD/node_modules/wrangler/bin/wrangler.js" \
  "$LOCAL_RELEASE_ROOT/runtime" "$RELEASE_INVENTORY_SHA256" 18790 \
  > "$LOCAL_RELEASE_ROOT/rehearsal-receipt.json"
```

Retention streams file hashes and copies; restoration verifies the externally
supplied inventory hash and every file before serving the retained Worker with
`--no-bundle`. The verified configuration is copied into the separate runtime
directory with only the Worker and asset paths made absolute, so Wrangler does
not create temporary directories in the restored tree. A PASS receipt is written
only after post-smoke inventory verification. Symlinks, traversal, unexpected files, changed hashes and files
outside the verified workspace device fail closed. A matching checksum proves
integrity against that expected inventory, not publisher authenticity or release
authorization. Preserve partial outputs and failure receipts for diagnosis; do
not reuse their directories as a successful release.

The smoke process checks that its port is unused, waits for its own Worker,
and checks health, the complete catalog count, visible home/detail HTML without
JavaScript, unknown-record 404, archive noindex behavior, and human/machine
ranking parity. It terminates its own process group. Preserve
`runtime/restore-smoke.json`, the external retention receipt, restored bytes and
runtime logs/state separately from production evidence. The Wrangler executable
and Node runtime come from the current qualified toolchain; they are not an
independently retained operating-system image.

The original unavailable-publication lane remains supported. The accepted lane
additionally requires an authority JSON containing `ledgerRoot`,
`currentRightsPolicyPath`, `currentPublicationPath` and `expectedRightsHash`.
The current policy contains `revoked_rights`, `checked_at` and
`review_valid_until`. These external files must be independently maintained;
copying an archived policy does not establish that it is current. Symlink and
hardlink aliases into the retained evidence are rejected. Supply this authority
file as the fifth argument to `retain`, fourth to `restore`, third to `verify`,
and sixth to `restore-smoke` (after the port). The expected inventory hash stays
external as before.

Accepted retention packages private ledger/capture evidence under `evidence/`,
outside served `assets/`. Verification recomputes projections, checks capture
spans and current schema hashes, and rejects expired/revoked rights, stale or
withdrawn publication pointers and changed bytes. The local smoke injects the
current rights pin only after those checks. Raw publication assets remain 404.
The local synthetic preparer exercises this path without granting any publisher
rights: `node scripts/release-source-selection/rehearse-publication.mjs FRESH_ROOT`.
Its fixtures are never production source approvals.

`node scripts/source-selection/local.mjs withdraw LEDGER_ROOT EXPECTED_BUNDLE_HASH REASON`
withdraws the local pointer and rotates its rights policy. Propagate the returned
rights hash to the trusted serving configuration and maintain the current
authority files; the static Worker cannot read local ledger changes. Before
restoring an older artifact, recheck current authority. Changing the trusted
rights pin makes stale assets fail closed; replacing an asset alone is not a
completed withdrawal. No Plumbob fallback is established by these tools.

Normal `cf:deploy` refuses an accepted publication. Use the approval packet's
production handoff and `scripts/release-source-selection/deploy-approved.mjs`
for that lane. It revalidates actual human records, current authority, the exact
qualified Worker/assets and inventory-bound release approval. Preparation is
the default; only explicit `--apply` calls Cloudflare. It deploys retained bytes
with `--no-bundle`, records the command result, and checks the publication on
both domains. Full browser/API release verification remains part of operational
acceptance; a failed readback is not reported as deployment success.

## Promotion record

Before promotion, retain the exact commit/tree, lockfile, build hashes, corpus
and rights identities, test receipts, browser results, current review decisions,
and restoration result. Record the actual deployment ID only after deployment.
Do not change historical receipts to make them describe this candidate.

Source acceptance, intended-use observation, release authorization and commercial
results remain different decisions. Start the 90-day operating review clock only
at the focused public release. Review even with zero paid engagements; absent
exposure means demand is unassessed, not disproven.

## Runtime build identity

Use the repository Wrangler wrapper for the release dry run (`npm run cf:dry-run`). It embeds `ushso.runtime-build-identity.v1` in the Worker: source Git revision and dirty state, complete bundled source-graph digest, lockfile digest, runtime-configuration and bundler-argument digests, staged-asset inventory digest and a deterministic `build_id`. Direct Wrangler invocations that omit this define remain explicitly `not_configured`; the health endpoint does not invent an identity from catalog dates or counts.

The wrapper writes immutable preparation receipts to `.wrangler/runtime-build-identities/<build_id>.json`. After a successful dry run it rechecks source/configuration/assets, verifies the identity is present in the bundled Worker, and writes `<build_id>.compiled.json` with the exact Worker artifact SHA-256 and byte length. Changed inputs fail qualification. A second artifact with the same identity cannot overwrite a different compiled receipt. These files are local release evidence, not public API responses or deployment receipts.

For promotion, retain the compiled receipt, exact dry-run Worker bytes and exact staged asset tree; upload that Worker with `--no-bundle`. Match live `/api/health` → `build.identity.build_id` and its source/assets digests to the retained receipt. Independently verify the uploaded artifact hash and Cloudflare version/deployment identifiers. The embedded build ID is not a Cloudflare deployment ID and does not cover runtime secret values. Commit and freeze source before final preparation so `source_dirty` is false; intermediate dirty builds are identified honestly and are not release approval.
