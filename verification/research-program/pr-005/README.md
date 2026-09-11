# PR-005 evidence

Sanitized producer evidence for freshness/grain corrections. Packet validity is not independent review or scientific approval.

## Binding

- Owner: Grok. Interface identity: Grok 4.6. Assignment model label: grok-4. The producer self-label is not a serving-model attestation.
- Reviewer: Astra.
- Original PR logical base: `15b351a92af729f9ba07359fd210123fdfd76bb3` (tree `c46c95ad838b78d4a26c86454be82f3835c49e51`).
- Continuation execution base: `941c9cd02a3a87c4239e6b75cdccbf4c8ec095e9` (tree `4d3bc23a2e4c97a9fd044bf3157f83a347995407`).
- Managed branch/task: `codex/ce-ushso-pr005-grok-r2-2026-pr005-freshness-r2-029d2d4b27dc-4eaf084b` / `pr005-freshness-r2`.
- Dependency merge: PR-004 `463f092f71c0ed1ef2aa5baa29b186e5697d04ce`. Accepted producer head `78d164e816049c45193b17c2267f64c8fb783399` is not relabeled as the dependency merge.
- Generation: `live-2026-09-03-85b50522b420`. Manifest SHA-256 `85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e`.

## Replay

```bash
node --test tests/research-program/freshness-and-grain.test.mjs
node --test tests/wp1-repository-abstraction.test.mjs
npm run test:web
npm run test:retrieval
node /mnt/d/tmp/plumbob/ushso-research-program-20260910/pr005-independent-semantics-v3.mjs "$PWD" "$PWD/verification/research-program/pr-005/evidence/c-005-4/semantics"
node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-005.json
```

R005-1 through R005-4 are functionally corrected. `npm run test:worker` still fails closed on the independently confirmed WP11 historical-input gate. That policy is outside this PR; the proposed follow-up is in `evidence/c-005-4/proposed-wp11-current-input-pins.json`. Prior C-005-1/C-005-2/C-005-3 receipts remain.
