Correct facet filtering preserves legacy section aliases while keeping canonical values exact. Query and embedded-receipt filters now retain replayable wire IDs; current-result counts, unavailable-facet explanations and mobile description IDs remain scoped and usable.

- Assignment: PR-006; P1 / 1B; R01/R02; F04/F17/F24.
- Owner: original task owner retained in the handoff; Grok finalized correction evidence. Reviewer: Astra, with separate metadata review.
- Original integration base: `c58787297fc543b3fdd31736e1c96ed1af29ffd8`.
- Dependencies: PR-004 `463f092f71c0ed1ef2aa5baa29b186e5697d04ce`; PR-005 `4fa2e0b5c8ee210cff9750a59e69df4b4a527fdc`.
- Producer head: `a153a3d5e734fee17d9016b8d36b0f94006f24fe`; branch `codex/ushso-pr006-facets-isolation-20260911`. Combined review head: `954a237a8984d06f5ea0ab15f83c71ce210bf09a`.
- Identity and compatibility: corpus v1.2.0 keeps 3434 published / 3430 searchable / 4 isolated records. Frozen response schemas, reference engines, source rows and cohort identities are preserved. No migration is required.
- Verification: `npm run typecheck --workspace @ushso/observatory-web` and `npm test --workspace @ushso/observatory-web -- src/providers/discoveryProvider.test.ts src/data/facets.test.ts` exited 0; 29 focused tests passed. The producer handoff validator exited 0.
- [Handoff](https://github.com/ajhcs/ushso/blob/a153a3d5e734fee17d9016b8d36b0f94006f24fe/docs/research-program/handoffs/PR-006.json); [Correction evidence](https://github.com/ajhcs/ushso/blob/a153a3d5e734fee17d9016b8d36b0f94006f24fe/verification/research-program/pr-006/c0064-r1-legacy-matching-and-receipt-replay.json). Exact source/artifact SHA-256 bindings are recorded there.
- Exact combined review: 23 custom probes and 12 actual Chrome cases passed; separate metadata review reported no actionable findings. Final review receipts are retained locally; their durable publication link and combined hosted CI remain pending. The combined local gate passed all ten stages on the first attempt with one build on 954a237/tree a781e980 (run 20260912T040526Z-9d0ca8f43f35).
- Earlier failed reviews, the initial failed extra reviewer fixture, and old failed CI are preserved. The corrected five-case fixture rerun passed. The old `e3af8dd` gate does not qualify these bytes.
- Current state: keep draft. Component acceptance depends on the reviewed combined candidate. No scientific, participant, source-access, release or deployment qualification is claimed. No credentials, PHI, production environment contents or private evaluation inputs are included.
