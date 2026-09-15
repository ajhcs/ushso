# PR-075 final frontend review

Recorded against source on `codex/ushso-pr075-final-frontend-review-20260915`. This is a source-and-static-markup review, not a live-browser, AT, physical-device, or WCAG certification.

## Journeys inspected from current source

| Route | State inspected | Concrete issue | Disposition |
| --- | --- | --- | --- |
| `/` | Landing hero, tested journeys, How it works | Hero used a fixed 580px height while catalog-scope and two learn links stacked below dimensions. Footer claimed “access the nation’s health systems data.” How-it-works step 1 was generic. | Copy and height/overflow edits in this PR. Material catalog-membership limit retained. |
| `/search` | Results shell, facets, receipts | Back link said “Back to search” while targeting `/`. | Relabeled “Back to home.” Six result-card regions unchanged. |
| `/datasets/:id` | Details heading, researcher summary, not-found | Missing records already render a not-found page after PR-074. Learn link still states finding a source is not obtaining the data. | No invented disclosure. |
| Variables / dictionary | Details technical details and dictionary panel | Review-only dictionaries remain bounded. | Unchanged. |
| `/compare` | HCRIS/PHC4 and MRF presets | Price types remain distinct from patient bills. Envelope construction is not comparison completeness. | Unchanged; material limits retained. |
| `/workspace` | Local shortlist export | Question/notes remain opt-in. Credentials stay excluded. | Unchanged. |
| `/learn`, `/methods`, `/about` | Guides, methods, disclosures | Unsupplied About disclosures remain unsupplied. Methods claims stay bound to current eval receipts. | Unchanged. |
| `/plan` | Blocked planner surface | `plan_research` remains disabled. | Unchanged. |

## Screenshots

No current desktop/mobile screenshots were captured in this session. Prior PR-073/PR-074 logs are not reused as current captures. Live Chromium, Firefox and WebKit remain untested, not passed.

## Interaction evidence

- Keyboard/AT: PR-073 source checks remain; NVDA/Firefox, VoiceOver/Safari, and JAWS/Chrome remain untested.
- Browser matrix: PR-074 CSS viewport bounds remain; live engines remain untested. An emulator is not a physical-device test.
- Native WebMCP: untested in unsupported browsers.
- Export: citation/export behavior from PR-069 is unchanged and was not re-executed against live storage in this PR.
- Console: no live session was operated.

## Not remaining as accepted-journey defects after this PR

- No placeholder sample dataset is presented as a live payload.
- No dead primary-nav control points at `/plan`.
- No invented About affiliation, funding, staff, or outcome disclosure.
- Material limits remain: catalog membership is not payload access; HTTP 200 is not a completed research task; CCN is never NPI.

A beautiful page with unsupported data cannot pass. This review does not accept R12/R13/R16, certify WCAG, or change production.
