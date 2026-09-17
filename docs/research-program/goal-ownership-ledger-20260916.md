# Goal ownership and integration ledger — 2026-09-16

## Task identity

- Objective: make the USHSO research-program path answer 20 representative
  healthcare questions with evidence-bound source/gap briefs, downloadable
  evidence packets, and an explicit baseline/candidate catalog boundary.
- Owner: Codex, working under the objective in
  `/home/plumbob/.codex/attachments/fb2b48e3-0e2b-4344-9e3e-d736534fbf96/goal-objective.md`.
- Task: `ushso-goal-20260916`.
- Branch: `codex/ushso-goal-20260916`.
- Isolated worktree:
  `/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-goal-20260916`.
- Base: `origin/codex/research-program-integration-20260910` at
  `9035a81bff0b9aa4a6ccba59d7b8d2dad56fbc30`.
- Implementation head SHA: `b20f66f8117c6e6e1dac05eea7c9fa122a042d8d`.
  The final handoff commit adds only this ledger update; no production branch
  is edited by this task.

## Ownership boundaries

- This worktree owns only the navigator UI/data contract, catalog-mode
  separation, focused web tests, responsive styles, and the browser QA selector
  correction listed in the task diff.
- The pre-existing research integration worktree and its branch remain
  read-only inputs. Existing cohorts, receipts, candidate records, source
  metadata, and ledgers are preserved.
- No publisher payload retrieval, credentials, paid service, participant or
  assistive-technology session, scheduler activation, scientific acceptance,
  Cloudflare deployment, or production promotion is authorized by this task.

## Integration dependencies

- Depends on the merged evidence-ingestion/research-candidate head verified
  above, including the additive `v1.3.0-candidate` records and frozen baseline.
- Production build remains baseline `v1.2.0` at `/api/discover`.
- Candidate review build is opt-in through the explicit research-candidate
  Vite mode and `/api/candidate/discover`; candidate facts remain documentation
  and evidence-state claims, not payload-access claims.
- Initial independent Cursor review of `aa9d1f7` requested four bounded fixes:
  matcher specificity, candidate record/evidence binding, active-generation
  landing copy, and a clickable brief CTA. Those fixes are in `b20f66f`.
- Final independent Cursor review of `b20f66f` returned **PASS** with no
  findings. The reviewer did not modify the implementation branch.
- The exact-candidate release gate is the final handoff check for this tree. Its
  receipt is planned at
  `/mnt/d/tmp/plumbob/ushso-goal-20260916-release-gate.json`; the result is
  reported in the task handoff, and no deployment is implied.

## Evidence receipts

- Candidate Chromium CDP QA: `/mnt/d/tmp/plumbob/ushso-goal-20260916-browser-qa`.
- Candidate Chromium/Firefox/WebKit QA: `/mnt/d/tmp/plumbob/ushso-goal-20260916-cross-browser-qa`.
- Baseline Chromium QA: `/mnt/d/tmp/plumbob/ushso-goal-20260916-baseline-browser-qa`.
- These temporary receipts are outside Git; their limitations and exact final
  status are reported in the handoff, not converted into research acceptance.
