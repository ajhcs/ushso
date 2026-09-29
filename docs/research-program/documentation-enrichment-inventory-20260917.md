# Documentation-enrichment URL inventory — 2026-09-17

Owner authorization: 2026-09-17 navigator increment (100 requests / 100 MiB total / 10 MiB per response / 30s per request / 2 concurrent, 1 per host / 2 redirect hops / 1 transient retry; every request, redirect, retry charged before execution; 7-day validity 2026-09-17 to 2026-09-24).

Operation `OP-DOC-ENRICH-20260917` under `AUTH-DOC-ENRICH-20260917`.
Collector: `scripts/research-program/run-doc-enrichment.mjs`.
Ledger: `verification/research-program/evidence/documentation-enrichment-ledger.json`.
Authorization register: `verification/research-program/authorization/documentation-enrichment-authorizations.json`.

## Derivation rule

Every URL below comes from retained provenance — `apps/web/src/data/researchNavigator.ts` `officialDiscoveryUrl` values and `packages/retrieval/fixtures/named-source-registry.v1.0.0.json` `evidence_urls` — or from verified official publisher navigation discovered during execution (recorded as additive bindings). No guessed endpoints. Dataset row endpoints and bulk data files are excluded. No repeat HCRIS/PLACES payload copy.

## Initial inventory (23 URLs, 15 hosts)

| # | product_key | host | url | eligibility |
|---|-------------|------|-----|-------------|
| 1 | cms-hcris | data.cms.gov | https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report | product page + linked dictionary/methodology navigation |
| 2 | cms-hcris-methodology | data.cms.gov | https://data.cms.gov/sites/default/files/2024-10/aba118b3-4f1f-45a4-8c61-b392d96b1b12/Hospital%20Provider%20Cost%20Report%20Methodology_2024_508%20Approved.pdf | methodology (retained registry evidence) |
| 3 | cms-chow | data.cms.gov | https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-change-of-ownership-owner-information | product page |
| 4 | cms-ltcf | data.cms.gov | https://data.cms.gov/quality-of-care/long-term-care-facility-characteristics | product page |
| 5 | census-sahie | api.census.gov | https://api.census.gov/data/id/SAHIE | API catalog metadata / variable navigation root |
| 6 | cdc-places | data.cdc.gov | https://data.cdc.gov/d/i46a-9kgh | product page + Socrata API-view metadata navigation |
| 7 | cdc-maternal | data.cdc.gov | https://data.cdc.gov/d/e2d5-ggg7 | product page |
| 8 | cdc-infant | data.cdc.gov | https://data.cdc.gov/d/jqwm-z2g9 | product page |
| 9 | cdc-brfss | data.cdc.gov | https://data.cdc.gov/d/5eh7-pjx8 | product page |
| 10 | ahrq-hcup | hcup-us.ahrq.gov | https://hcup-us.ahrq.gov/databases.jsp | product/database directory + access instructions |
| 11 | ahrq-hcup-factsheet | hcup-us.ahrq.gov | https://hcup-us.ahrq.gov/news/exhibit_booth/hcup_fact_sheet.jsp | methodology/overview (retained registry evidence) |
| 12 | ahrq-meps | meps.ahrq.gov | https://meps.ahrq.gov/mepsweb/data_stats/download_data_files.jsp | file directory + codebook navigation |
| 13 | ahrq-compendium | www.ahrq.gov | https://www.ahrq.gov/chsp/data-resources/compendium-2020.html | product page + vintage docs |
| 14 | ahrq-compendium-tech | www.ahrq.gov | https://www.ahrq.gov/chsp/data-resources/compendium/technical-documentation.html | technical documentation (retained registry evidence) |
| 15 | cms-nppes | download.cms.gov | https://download.cms.gov/nppes/NPI_Files.html | file layout + dictionary navigation |
| 16 | hrsa-ahrf | data.hrsa.gov | https://data.hrsa.gov/topics/health-workforce/ahrf | product page + documentation navigation |
| 17 | samhsa-nsumhss | www.samhsa.gov | https://www.samhsa.gov/data/data-we-collect/n-sumhss-national-substance-use-and-mental-health-services-survey | survey documentation |
| 18 | cms-tmsis-taf | www.medicaid.gov | https://www.medicaid.gov/medicaid/data-systems/macbis/medicaid-chip-research-files | research-file access instructions |
| 19 | cdc-atsdr-svi | www.atsdr.cdc.gov | https://www.atsdr.cdc.gov/place-health/php/svi/index.html | product/methodology page |
| 20 | state-apcd | www.apcdcouncil.org | https://www.apcdcouncil.org/state-apcd-activities | program directory (national locator; state routes discovered via official navigation only) |
| 21 | state-licensure-ctx | www.cms.gov | https://www.cms.gov/medicare/health-safety-standards/certification-compliance | certification context (state directories require official navigation) |
| 22 | sheps-closures | www.shepscenter.unc.edu | https://www.shepscenter.unc.edu/programs-projects/rural-health/rural-hospital-closures/ | tracking list + methodology |
| 23 | aha-survey | www.ahadata.com | https://www.ahadata.com/aha-annual-survey-database | product + license terms |

Redirects must stay within the approved host scope. Private-network destinations, credentials, or out-of-scope content are rejected before following or parsing. Additive bindings for dictionary/codebook/methodology links found through official navigation are recorded in the ledger without resetting counters or increasing the budget.
