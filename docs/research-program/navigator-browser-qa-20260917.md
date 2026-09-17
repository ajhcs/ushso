# Navigator browser QA - 2026-09-17

Task branch codex/ushso-navigator-enrich-20260917 at b0f6152/db23826 code (dist rebuilt from same tree for serve).
Harness: Playwright-core 1.61 driving cached browsers (chromium-1228, firefox-1532, webkit-2311).
Script: task-owned /mnt/d/tmp/plumbob/ushso-navigator-qa-20260917/qa.mjs (assembled from reviewed parts; retained).
Servers: wrangler dev local, baseline on 8787, candidate preview on 8788 (built via the explicit candidate command sequence).

## Matrix

| mode | chromium | firefox | webkit |
|---|---|---|---|
| baseline (8 journeys + packet + return-focus) | 10/10 | 10/10 | 10/10 |
| candidate (AHRF + Sheps flips + packet + return-focus) | 4/4 | not run | not run |

Baseline journeys: SAHIE (sections order, NIPR_PT, census dictionary link, 3 https evidence links), PLACES (168 columns), maternal (provisional), Sheps gap (197 + REH), SVI (collision warning in Limits), HCRIS (Aggregation Level + methodology PDF), ownership fallback (honest no-dictionary text, no invented link), mobile 390px SAHIE (no h-overflow). Each journey asserts section order 1-6, content needles, dictionary/fallback behavior, >=1 https evidence link, no horizontal overflow, zero page errors, plus screenshot.
Packet check: SAHIE packet downloads with the v1.0.0 contract and >=1 source.
Return focus: HCRIS brief -> details -> back lands on the brief anchor (hash or focus-in-brief).
Candidate journeys: AHRF flip shows Indexed documentation-first candidate + Connecticut dual-scheme text; Sheps flip shows the candidate badge + 197 + RUCA vars (no dictionary link by design: inline schema only).

## Script bugs found (both QA-side, fixed, app untouched)

1. SAHIE text needle used lowercase attribute name instead of rendered heading; fixed to visible text.
2. Return-focus assertion required a location hash; the app restores via focus/scroll without always setting a hash. Assertion now accepts focus-in-brief. Re-ran green.
3. Sheps candidate spec wrongly expected a dictionary link; Sheps has representative vars with honest no-link fallback by design. Spec corrected.

## Coverage note

Candidate mode ran on Chromium only: the flip logic (coverageLabel + shared six-section template) is engine-independent and the identical template passed all three engines on baseline. Firefox/WebKit candidate runs remain available as a follow-up and are not claimed.

## Artifacts (task-owned, retained)

Screenshots (24 baseline + 4 candidate + 10 re-verify), downloaded packets (3 baseline SAHIE + candidate), JSON reports: /mnt/d/tmp/plumbob/ushso-navigator-qa-20260917/output*/.
