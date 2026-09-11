# PR-005 evidence

Sanitized producer evidence for freshness/grain corrections. Packet validity is not independent review or scientific approval.

## Binding

- Owner: Grok. Interface identity: Grok 4.6. Assignment model label: grok-4. The producer self-label is not a serving-model attestation.
- Reviewer: Astra.
- Base: `15b351a92af729f9ba07359fd210123fdfd76bb3` (tree `c46c95ad838b78d4a26c86454be82f3835c49e51`).
- Dependency merge: PR-004 `463f092f71c0ed1ef2aa5baa29b186e5697d04ce`. Accepted producer head `78d164e816049c45193b17c2267f64c8fb783399` is not relabeled as the dependency merge.
- Generation: `live-2026-09-03-85b50522b420`. Manifest SHA-256 `85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e`.

## Replay

```bash
node --test tests/research-program/freshness-and-grain.test.mjs
node --test tests/wp1-repository-abstraction.test.mjs
npm run test:web
npm run test:retrieval
node verification/research-program/pr-005/observe-freshness-and-grain.mjs
node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-005.json
```

`npm run test:worker` currently fails closed on the WP11 historical pin for `apps/web/src/components/ResultCard.test.ts`. That pin is outside this PR's owned scope; the proposed delta is in `evidence/c-005-3/proposed-wp11-resultcard-test-pin.json`.
