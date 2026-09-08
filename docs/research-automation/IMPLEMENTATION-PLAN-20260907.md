# Current implementation-plan review — 2026-09-07

This supersedes the status statements in the earlier pilot, expansion and Muse follow-up documents. It is not a release request or a declaration that all engineering/science is complete.

The review packet is retained under `/mnt/d/tmp/plumbob/ushso-implementation-plan-20260907`: `REVIEW.md`, `LEDGER.md` (22 tasks), `F01-F32.md` (individual gaps), source inventories, immutable combined artifacts and actual test evidence.

## Research completeness

The qualified package has 2,901 dictionaries across the 3,434-record catalog: CDC1,126/1,472, Census1,738/1,803, CMS37/159. Its 1,573,410 record-scoped entries contain 15,283 nonempty descriptions and zero explicit measurement units. All dictionary schema applicability remains unresolved. Labels and Census concepts are not converted into definitions; 533 catalog records lack a qualified packaged dictionary, which does not establish publisher absence.

This pass adds two CMS dictionaries and273 entries: three Clinical Laboratory definitions and270 MCBS labels. All prior2,899 descriptors are unchanged. CMS now has6,118 entries, including1,000 nonempty descriptions; all37 dictionaries remain partial. All159 CMS records have a cause ledger. Remaining122 ordinary-extraction gaps comprise97 captured dictionaries requiring parsers,21 availability/absence-unverified cases, two historically rejected extractions, PBJ unresolved identity and QIES context-scoped identity. Detailed overlapping geometry/header causes are retained. QIES733 and MCBS112 physical pages were captured in bounded resumable windows; QIES856 contextual entries, PBJ81 passages and45 rejected historical entries remain separate. MCBS189 issues are retained rather than invented fields.

Use [metadata update cycle](BOUNDED-UPDATE-CYCLE.md), [CMS qualified dictionary cycle](CMS-BOUNDED-UPDATE-CYCLE.md), [large-PDF windows](LARGE-PDF-WINDOWS.md) and [composition](DICTIONARY-COMPOSITION.md). Each command preserves exact hashes, proposal-only boundaries and typed failures. The CMS cycle emits bounded field-level before/after diffs. Historical metadata resume cannot rewind a newer latest proposal; lost state is explicit rather than guessed. Remaining workflow gaps include automatic capture-to-qualified CMS-plan construction and fine-grained adoption from partially failed family groups. No recurring service was installed.

## Actual verification

The frozen review artifact is `artifact-combined-v3`, Worker SHA256 `c7a8af205dde771a6856426f8d8e2e51f6f2704a795f62a73a7751d3f853ffc7`, dictionary manifest `d8a1ea4452cadff0e5233ee47f929e589652af4d515e5558e4a6871c9151938d`. All41,053 assets are retained and hashed. Review configuration is test-only, not an authorized production deployment.

Full dictionary traversal made38,604 requests: every2,901 record,34,046 page and4,553 fragment reconciled to qualified source values, including348 oversized fields; maximum response79,199bytes. The traversal binds unchanged API/dictionary/config components from v2; v3's explicit five-path delta changes UI files only. Separate corruption/healthy/empty isolation tests pass.

All42 original audit questions plus five homepage examples were rerun on the exact c7 Worker.47 retained bodies and341 extended sort/filter/cursor responses match both paired performance builds byte-for-byte without normalization. Corpus inventory3,434/usable3,430/four typed isolated records is asserted dynamically. Corrected free-data checks retain unknown cost as uncertain.

The actual v3 artifact serves both schema generations and all transitive references;29 fetched schema IDs compile, eight actual response envelopes validate, strict legacy incompatibility is explicit, and missing JSON replaced by SPA HTML fails verification. Historical28 schema hashes are unchanged.

Desktop1440, mobile390 and320 browser checks pass API/rendered/export order for four sorts, dictionary pagination, oversized summaries, SCI04/05 review-only notes, page-two Back/Forward scroll/focus, correction privacy and public contact/operator. A full canonical-ID blank-detail bug was fixed and retested.131 web tests pass. These are targeted Chromium checks, not exhaustive accessibility or all history-title combinations.

A completed native gpt-6-astra session against the real plugin made four actual calls covering pagination, typed unknown and expired-cursor restart. All eight native WebMCP calls returned their expected five positive/three typed-unknown outcomes; planner remains absent. Marketplace installation UI is not claimed.

## Latest performance — target not met

The authoritative paired local workerd sample ran23:04:41–23:07:49 UTC. It supersedes prior45% and141-warm-request descriptions, without retroactively accepting them.

| Metric | Runtime-built control | Opt-in lexical index |
|---|---:|---:|
| Cold mean | 1,066.9ms | 794.8ms |
| Cold range | 976.4–1,221.3ms | 727.4–854.3ms |
| Concurrency-eight maximum | 363.1ms | 346.0ms |
| Concurrency-eight samples ≥300ms | 21/24 | 21/24 |

All202 timed requests succeeded. Cold mean improved25.5% in this ordered trial, but every cold request remains above300ms. Both lanes also passed48 bounded dictionary/supplement/machine calls, maxima26.0/27.1ms. Ordinary final heap snapshots were74.75/74.80MB, not peaks. The prototype remains opt-in: no production adoption, memory-reduction claim, edge SLO or warm-only acceptance is inferred. Further compact validation/loading and contention work requires architectural review.

A separate local POST failure is explained: no_bundle mode omitted Wrangler development request-body draining. Normal bundling passes, and disabling only that middleware reproduces failure. Failed controls remain retained; no unbounded drain was copied into production or input guard relaxed. The older unexplained timeout remains open.

## Scientific and operational decisions

Four exact SCI04/05 claim drafts, value hashes, source bindings and before/after diffs are ready for scoped review; none is selected as approved. Rendered notes distinguish HHA calendar years from SNF/Hospice fiscal years, suppression from beneficiary counting, and drug-dependent dosage from a common physical unit. No row-key, join, cross-drug conversion or depression/bipolar meaning is approved by those notes. SCI01/02/03/06 remain explicitly conflicted/bounded/candidate observations; exact-product and release evidence is still missing.

Current Muse review is **not permission-blocked**: public sharing is authorized. The new DSH worker failed before model output because its configured3.4.2 credential-handoff loader was missing. Repair that plugin runtime; historical Muse reviews, including source-truncated output, are not substituted as a fresh complete review.

Ajv8.20.0/npm11.19.1 remain pinned by the existing lockfile. Both declared minimum Node22.15.0 and build Node24.14.0 clean installs/builds and relevant suites passed; final dependency tree and npm audit are clean. The historical [Ajv $data ReDoS advisory](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) is fixed, not accepted as an exception. Separate esbuild/workerd install-script warnings remain recorded; no scripts were approved. Pypdf6.18.0 remains hash-pinned with explicit isolated interpreter and resource bounds; XML/archive adversarial checks pass.

[Cursor operation packet](CURSOR-OPERATION-PACKET.md) identifies exact production scope, binding, undeployed-version workflow, validation and rollback. Remote key provisioning still needs authorized operator/secret-manager selection; rotation immediately invalidates current cursors. Unknown quota is not an enforced policy. Account storage entitlement for41,053 review assets remains unverified. AUTH15, release-relevant scientific limitations and performance acceptance remain owner decisions; none is implicitly accepted.

## Release boundary

The repository-declared one-build gate plan was inspected, not run. The last complete receipt `20260907T191308Z-9a485f3052ee` failed three `SUCCESSOR_APPROVAL_STALE_SUBJECT` checks for WP0/WP11/CI and skipped downstream build/audit/dry-run stages. It predates this candidate. Supplemental checks do not convert those skipped stages into passes.

Finish independent gaps, obtain exact scientific decisions, integrate approved scope through validated builders, then prepare new scoped successor subjects without carrying over old approval. Only after authorized receipts are issued/validated may the complete exact-candidate gate build once and retain its production bundle. Deployment requires separate approval.

Future gate runs must use `/home/plumbob/bin/with-dev-storage release-gate …`, with scratch/snapshot storage under /mnt/d and no root-disk fallback. Historical receipts and artifacts stay preserved.
