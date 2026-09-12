# Final decisive correction replay

All 23 requested probes passed against combined commit `954a237a8984d06f5ea0ab15f83c71ce210bf09a`, tree `a781e9801224af92b51389fb898f0b67ab261982`.

| Group | Result |
|---|---|
| Original data probes | 2/2 |
| Original web probes | 3/3 |
| CMS correction boundaries | 4/4 |
| Web correction boundaries | 6/6 |
| Additional CMS boundaries | 3/3 |
| Corrected additional web fixtures | 5/5 |

CMS mapping evidence and explicit wire-name requirements hold. Legacy facet matching survives; query and receipt filters replay displayed records for mixed filters, exact canonical near misses and zero-result cases. No actionable finding appeared within these probes.

All commands passed on their first workspace-write execution with Node v24.14.0. The clean HEAD/tree, four corrected source/test file hashes and all six retained probe hashes were identical before and after. The initial invalid extra-web fixture was preserved and not executed. Full command output, exact times/exits and per-command identity snapshots are retained beside `review.json`; `artifact-manifest.json` binds the review files.

The corrected native Chrome harness is `/mnt/d/tmp/plumbob/ushso-research-program-20260910/pr006-controller-browser-v6.mjs`, with adjacent `pr006-controller-browser-entry.tsx`. It exercises 12 actual React/API/fixture cases. Its Python wrapper still binds `5d8a8dd` and an old writer task, so use a new scratch wrapper for the final commit. It needs existing candidate dependencies, `/usr/bin/google-chrome`, a fresh output directory and free localhost ports 18886/9236 (configurable). It builds a small scratch esbuild bundle and starts its own server/Chrome; no separate full npm build is required. Detailed prerequisites and hashes are in `browser-harness-inventory.json`.

No browser run, full regression suite, typecheck, build, gate, hosted CI, external request, publication, acceptance or deployment was performed by this review. The root controller owns the full gate. These retained fixture checks do not qualify scientific claims or R01-R16.
