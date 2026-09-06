# Release-candidate browser QA

Candidate corpus: v1.2.0, 3,434 published, 3,430 searchable, four isolated. Browser: actual headless Google Chrome against the built local Cloudflare Worker at `http://127.0.0.1:8794`.

Browser plugin availability: absent; the repository's real headless-Chrome/CDP harness was used. The machine-readable receipt is `/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final14/browser-qa-receipt.json`.

| Surface | Viewport | Result | Evidence |
|---|---:|---|---|
| Homepage | 1440×1000 | Pass: navigation, examples, scope framing, and footer rendered. | `/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final14/desktop-home.png` |
| Homepage | 390×844 | Pass: exact 390 CSS-pixel layout rendered without horizontal overflow. | `/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final14/mobile-home-390.png` |
| HCRIS search | 1440×1000 | Pass: one contextual exact-source leader, canonical order, full-match facets, receipt control, interpretation, and four-record isolation notice rendered. | `/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final14/desktop-search.png` |
| HCRIS search | 390×844 | Pass: exact 390 CSS-pixel controls/notices/results layout with no overflow. | `/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final14/mobile-search-390.png` |
| HCRIS search | 320×800 | Pass: exact 320 CSS-pixel header, search, sort, receipt, and result controls remained visible with document/body scroll width equal to the 305 px scrollbar-adjusted client width. | `/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final14/mobile-search-320.png` |
| Exact CMS detail | 1440×1000 | Pass: exact production record guidance, unresolved observation grain, evidence, and safe access route rendered. | `/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final14/desktop-details.png` |
| Exact CMS detail | 390×844 | Pass: decision and access content reflowed; no invented search-relevance badge. | `/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final14/mobile-details-390.png` |

The harness clicked all five homepage suggestions and waited for their reviewed production leaders:

1. CMS HCRIS hospital cost reports by state → Hospital Provider Cost Report
2. CDC maternal mortality data → VSRR Provisional Maternal Death Counts and Rates
3. CMS hospital ownership in Pennsylvania → Hospital Change of Ownership - Owner Information
4. Public-use hospital utilization data → National Hospital Ambulatory Medical Care Survey, Public-use data 1992-2022
5. CMS Medicare inpatient hospital utilization → CMS Program Statistics - Medicare Inpatient Hospital

For `maternal mortality`, Chrome also compared the API sequence, rendered cards, downloaded `displayed_ordered_ids`, and receipt citation order for canonical relevance, Title A–Z, newest publisher release, and latest observation coverage. All four desktop sorts passed; Title A–Z also passed at 390×844. The browser emitted no warning/error diagnostics and displayed no framework overlay.

The same stressed Worker returned the exact dataset route and stayed healthy. The earlier detail 503 was a masked repository-summary TypeError caused by a removed empty compatibility field, not a successful gate or an unexplained Worker exit; the implementation and stability evidence are recorded in the F01–F32 checklist.
