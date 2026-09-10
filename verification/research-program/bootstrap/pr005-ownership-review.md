# PR005 proposed ownership amendment

Review is read-only and pinned to integration commit
`d0131f10d67fa6ad417aa45f88a37de345a85ffb` (tree
`76a3ea90e2eb770174984c18d95b499c91752a7c`) in
`/mnt/d/worktrees/plumbob/ushso-research-program-20260910`. The supplied
preparation map was pinned to the older `6c5007faa80632864e87d592b695fa2e7d75d47d`
(tree `434a0b977570ad4828bcc7ef03034f5ed462a175`); its four-path map remains
useful, but the hashes in `source-hashes-d0131f10.json` are the authoritative
inspection hashes for this scope decision. No repository files or tests were
changed/run.

## Existing packet ownership

The PR packet already owns:

- `packages/retrieval/tools/retrieval-core-v1.2.mjs`
- `worker/public-query-service.mjs`
- `apps/web/src/lib/researcherGuidance.ts`
- `tests/research-program/freshness-and-grain.test.mjs` (planned; absent at the pinned head)

The first two are sufficient for the request-side portion only if the service
captures one request evaluation instant and passes it through every browse,
dataset, and discover path. `worker/public-query-service.mjs:71-74` creates the
request session, and its calls at `87-115`, `135-165`, and `168-175` already carry
session context. `worker/index.mjs:281-346` routes all three public endpoints
through that session. The owned `dataset` path still emits a direct result with
no derived metadata, so it must attach the same clock-bound freshness object or
leave detail freshness explicitly unresolved.

## Minimum additive ownership

Add these files to PR005 ownership:

| Path | Why it is needed | Pinned call/contract boundary |
| --- | --- | --- |
| `packages/search/static-search-backend.mjs` | Forwards the request evaluation instant into the promoted engine for search and browse. Current calls discard it. | `:20-25` loads the engine; `:32-38` passes only `{ signal }`. |
| `apps/web/src/types/discovery.ts` | Extends the derived response freshness shape for latest-attempt and explicit catalog/payload-check states, with null/unknown states preserved. | Raw record freshness is `:224-231`; derived response freshness is `:258-288`; result metadata is optional at `:324-340`. |
| `apps/web/src/types/catalog.ts` | Carries the same freshness fields through the UI-facing `DatasetVerification` model and family view. | `DatasetVerification` is `:42-50`; `DatasetFamily` is `:67-96`. |
| `apps/web/src/lib/catalogAdapter.ts` | Maps canonical response freshness into the UI model, including direct dataset fallback paths, without copying inferred grain into a claim. | `verificationDetails` is `:110-140`; `resultToView` is `:223-275`; grain is intentionally unresolved at `:51-55`. |
| `apps/web/src/components/ResultCard.tsx` | Renders the request-clock freshness status and the three separate display states inside the existing evidence/access region; removes the wall-clock fallback. | `checkedLabel` and its `Date.now()` fallback are `:15-28`; card rendering is `:44-106`. |
| `apps/web/src/pages/DatasetDetailsPage.tsx` | Renders the same status set for dereferenced records and removes the independent browser-clock fallback. | `freshnessState` and `Date.now()` are `:40-47`; response/fallback selection is `:105-112`; current panel is `:203-208`. |
| `tests/wp1-repository-abstraction.test.mjs` | Verifies one fixed request clock reaches static search and that browse/dataset/discover remain compatible after derived metadata is attached. Existing exact-parity assertions need a fixed injected clock. | Service construction is `:139-145`; exact browse/dataset/discover parity is `:155-169`; worker route parity is `:171-179`. |
| `apps/web/src/lib/researcherGuidance.test.tsx` | Adds the missing regression that `Typical unit` stays unresolved when only `unit_of_analysis` tags exist. | Existing guidance field assertions are `:14-33`. |
| `apps/web/src/lib/catalogAdapter.test.ts` | Confirms unresolved grain and explicit catalog-only/payload-unknown freshness/access mapping survive adaptation. | Grain/access assertions are `:55-72`. |
| `apps/web/src/components/ResultCard.test.ts` | Adds a card fixture covering last successful metadata check, latest attempt, stale state, and payload check unknown while preserving the six required regions. | Six-region contract is `:13-48`. |
| `apps/web/src/pages/DatasetDetailsPage.test.tsx` | Adds a detail rendering/helper fixture for the same status distinctions; current test only covers identity-bound guidance. | Existing test scope is `:18-29`. |

The packet-owned `researcherGuidance.ts:138` remains the only product change
needed for the inferred-grain label itself. `catalogAdapter.ts` already returns
`Observation grain unresolved` and `ResultCard.tsx` already labels inferred
category topics as search aids; those boundaries should stay unchanged except
for the shared freshness mapping above.

## Interface and source-contract decisions still pending

`packages/search/search-backend.mjs:1-10` only validates backend version and
method presence; it has no typed options contract. No edit is required if the
current production backend remains the only consumer and the new `now` option is
passed opaquely. If PR005 wants a shared guarantee that every backend preserves
that option, include this file as a conditional interface amendment, document a
request-context/options shape, and add a version-compatible test. Do not let an
alternate backend silently discard the clock.

The pinned raw record contract has no latest-attempt timestamp/outcome or
payload-check status. `packages/retrieval/tools/catalog-contract.mjs:177-193`
currently derives only `last_checked`, `next_review_due`, `freshness_state`, and a
free-text `failed_refresh_state`; `browserRecordErrors:75-96` does not validate
attempt/payload fields. Therefore:

- If PR004's accepted interface supplies a structured derived freshness object,
  bind PR005 to that exact interface and keep `catalog-contract.mjs` outside
  this amendment.
- If PR005 must define the object, add
  `packages/retrieval/tools/catalog-contract.mjs` as a shared-contract owner
  and add the corresponding `worker/live-verification.mjs` and
  `apps/web/src/data/liveVerificationOverlay.ts` producer/fixture changes only
  when the accepted source contract actually carries those fields.

Those producer paths currently write only `metadata_observed_at`, verification
status/method, evidence and variables (`worker/live-verification.mjs:48-63`,
`apps/web/src/data/liveVerificationOverlay.ts:130-146`). Do not fabricate a
latest attempt or payload success from that data. PR005 remains blocked from
claiming full C-005-3 until PR004's final interface/head is accepted and bound.
`apps/web/src/providers/discoveryProvider.ts` already treats item metadata as
optional and validates the canonical record boundary (`:67-185`); no provider
implementation edit is required unless the accepted freshness schema adds
mandatory runtime validation.

No extra edit is indicated for `worker/index.mjs` or
`worker/static-composition.mjs`: they already route the request into
`PublicQueryService.openRequest` and inject `StaticSearchBackend`.

## Compatibility risks

- A live request clock changes only derived freshness and receipt timestamps;
  direct benchmark calls must keep their frozen default clock. Existing exact
  parity tests must inject one fixed instant rather than compare against wall
  time.
- Old fixtures and responses may omit new attempt/payload fields. Render typed
  `not recorded`/`not tested` states, preserving `unknown` and avoiding any
  inference of payload availability from catalog metadata.
- Adding a shared freshness shape can affect adapters, overlays, and historical
  receipts. Preserve old record/evidence bytes and wait for PR004's accepted
  interface before changing those producers.
- Keep `ResultCard`'s six `data-result-region` values and keep inferred units as
  search aids; C-005-2 must not alter scientific grain claims.

## Planned decisive tests (not run in this review)

- `node --test tests/research-program/freshness-and-grain.test.mjs`
- `node --test tests/wp1-repository-abstraction.test.mjs`
- `npm run test:web`
- `npm run test:retrieval`
- `npm run test:worker`

The focused fixtures should cover a September 10 request against a September 5
deadline, a September 4 before-deadline request, invalid/missing deadlines,
unchanged source/evidence hashes, inferred-only unit tags, catalog-only payload
access, no payload check, and a failed/latest attempt alongside the prior
successful metadata check. The full acceptance gate remains pending PR004's
accepted interface and final PR005 implementation.
