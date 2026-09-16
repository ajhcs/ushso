# int2 journeys copy/layout note

Branch: `codex/ushso-int2-journeys-20260917` (from `codex/ushso-integration-20260917 @ d5b8a8b`).
Date: 2026-09-16. Modes: baseline (3434, `live-2026-09-03-85b50522b420`) on :48381; candidate (3436, `candidate-2026-09-17-corr3-v1.3.0`) on :48382. Engines: Chromium (channel chrome), Firefox (firefox-1532), WebKit (webkit-2311).

## Review scope (apps/web only)

- `CandidateCatalogNotice.tsx`: plain answers in main paragraphs; counts/generations/API path only inside `<details class="technical-details">`. Compact notice on landing/search keeps same boundary.
- `DatasetDetailsPage.tsx` candidate section: five plain questions as paragraphs; identifiers/promotion status only inside its `<details>`. Machine identity/generation/joins only inside “Machine fields, identity, variables, and join routes” details.
- `SourceSummary.tsx` / `ResearcherDecisionSummary.tsx`: purpose, coverage, access, last metadata check, payload check, clear next action in main flow; unknowns shown as unknown/unresolved; boundary lines (“Catalog membership is not payload access”, “not proven payload or browser access”) present.
- `SearchResultsPage.tsx` footnote shows scoped generation + ranking version + publisher-confirm reminder; interpretation in expandable “How this question was interpreted”.
- `ResultCard.tsx`, `LandingPage.tsx`: finding-vs-obtaining boundary present; no download/payload verbs.

## Journeys checked

HCRIS (“CMS HCRIS hospital cost reports”) in both modes; AHRF (“Find AHRF county workforce files”) and Sheps (“Sheps rural hospital closures”) in candidate only; absent (0 cards) in baseline. Verified: plain answers, unknowns, no fabricated access claims, documented route hrefs (https, not fetched), every packet download parsed (source packets + static research packets with tested:false/executed:false/documented-not-verified), return-to-results URL+hash+focus, 390px mobile (0 overflow), keyboard Tab/Enter to search and open, bad routes show “Dataset record not found” / “Page not found”, console 0 on main journeys, APIs unmixed per mode.

## Fixes made

None. No blocking copy/layout confusion was found, so no `apps/web/**` edits were made. This keeps all 221 vitest tests green without weakening assertions and leaves sealed files untouched.

## Minor observations (not fixed, by constraint or by design)

- Landing and results footnote show generation identifiers inline in plain text (e.g. `live-2026-09-03-85b50522b420`). Candidate arithmetic itself stays inside expandable details; inline generation is the catalog pin users need to verify counts. Moving it would churn tested markup for little gain.
- Direct loads of bad routes return HTTP 404 with correct error UI; Chromium/WebKit log document-404 console errors for those intentional loads (Firefox does not). Fixing status would require `worker/index.mjs`, which is explicitly untouched.
- One WebKit baseline run read return focus as BODY (hash correct); re-run showed correct link focus. Likely rAF timing in harness, not app bug.
