# Independent review verdict - navigator enrichment increment (2026-09-17)

Reviewer: independent subagent (authored nothing on this branch; read-only worktree at detached b0f6152).
Scope: task branch codex/ushso-navigator-enrich-20260917 vs base a9cb514 (PR 106).
Request: docs/research-program/navigator-enrichment-review-request-20260917.md.
Reports (task-owned): /mnt/d/tmp/plumbob/ushso-review-20260917/evidence/report.md, code-ui/report.md, browser scripts.

## Initial verdict: FAIL (one merge-blocking defect)

Ledger SHA verifiability: all 10 HTML captures mismatched their ledger SHA-256 because .gitattributes text=auto eol=lf normalized CRLF to LF at commit. JSON/PDF (12) verified; totals, charges, bindings, auth window all verified.

## Resolution (commit 7cc2c9f)

- .gitattributes marks doc-enrichment captures/* as -text (byte-exact going forward).
- The 10 HTML blobs rewritten to the CRLF originals (working-tree bytes already matched the ledger).
- Sheps-release-notes binding basis gained the same-millisecond timing note.
- Plan R3/R4/R8 wording corrected (link-list granularity, no observed_at claim, no viewport claim).

## Confirmation: PASS

Reviewer recomputed all 22 capture blobs at origin (git cat-file): 0 mismatches, byte total 9,738,457 reconciles, 28 requests charged. No re-review of evidence reasoning required or performed after the mechanical fix.

## Standing results (all PASS)

- Recount 20/20/201: 76/32/90/2/1 with 17 unknown-profiles (baseline re-recount 53/32/113/2/1, 19).
- Evidence spot-checks: every promotion within capture support; no successfully_tested; no joins proven.
- Validators extended, never weakened; packet contract additive-only; evidenceRefs resolve.
- UI: six sections, dictionary links + honest fallback, SVI warning in Limits, F-05 fixed; F-06/F-12a-b documented follow-ups.
- Tests: test:web 50 files / 244 tests pass; collector validate ok.
- Browsers: Chromium 12/12, Firefox 12/12, candidate 5/5; WebKit not exercisable (version skew + system libs), risk recorded as low.
