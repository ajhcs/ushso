# Doc-enrichment batch 2 — 2026-09-17 (Sheps closures, infant VSRR, HCRIS methodology, MEPS)

Operation `OP-DOC-ENRICH-20260917` under `AUTH-DOC-ENRICH-20260917` (valid 2026-09-17 to 2026-09-24).
Branch: `codex/ushso-navigator-enrich-20260917`. Collector: `scripts/research-program/run-doc-enrichment.mjs`
(validate passes; HEAD fa2b7a6 at commit time — two frontend-brief commits aa92424/fa2b7a6 landed
mid-batch in the same worktree, different files, no interaction with this batch).
Ledger: `verification/research-program/evidence/documentation-enrichment-ledger.json`.
Evidence: `verification/research-program/evidence/doc-enrichment-20260917/{captures,receipts,attempts}/`.
Inventory: `docs/research-program/documentation-enrichment-inventory-20260917.md` (23 URLs) + 5 additive bindings below
(1 infant-metadata pre-bound before phase 1; 4 Sheps-notes/MEPS pages pre-bound before phase 2).
Baseline: `docs/research-program/source-field-baseline-20260917.md` (20/20/201: 53 documented / 32 observed / 113 unknown / 2 provisional / 1 conflicting).

This file is FINDINGS ONLY. `apps/web/src/data/researchNavigator.ts` was NOT edited.

## Budget accounting

Hard budget: 100 requests / 100 MiB total / 10 MiB per response / 30 s per request / max 2 concurrent
(1 per host) / max 2 redirect hops / 1 transient retry. Every request, redirect hop, and retry charged
BEFORE execution. No credentials, payment, accounts, or personal data.

| metric | this batch | cumulative used | limit | remaining |
|---|---|---|---|---|
| requests (incl. redirect hops + retries) | 11 | 28 | 100 | 72 |
| bytes stored | 1,270,341 (~1.21 MiB, after token redaction; 1,270,387 at capture) | 9,738,457 (~9.29 MiB) | 104,857,600 | 95,119,143 |
| retries consumed | 0 | 0 | 1 per request | — |
| max single response (cumulative) | 599,443 (infant page, post-redaction) | 5,224,311 (Census data.json, batch 1) | 10,485,760 | OK |
| concurrency | sequential (max 1 at a time; per-host 1) | sequential | 2 (1/host) | OK |
| redirect hops | 1 (infant product page, same-host in-scope) | 5 total | 2 per request | OK |
| private-network / credential rejections | 0 triggered (all URLs https, no userinfo, public hosts) | enforced | reject-before-follow | enforced |

Retrieval window: 2026-09-17T15:27:10Z – 15:28:23Z (10 attempts; `started_at` chained from the
previous capture file mtime in the sequential run, `ended_at` = own capture mtime; method noted because
the collector is validate-only and curl does not emit per-request ISO clocks).

## Intended URLs (all in ledger inventory or additive-bound before fetching; no guessing)

Initial (inventory, 5): sheps-closures
`https://www.shepscenter.unc.edu/programs-projects/rural-health/rural-hospital-closures/`; cdc-infant
`https://data.cdc.gov/d/jqwm-z2g9`; cms-hcris-methodology
`https://data.cms.gov/sites/default/files/2024-10/aba118b3-4f1f-45a4-8c61-b392d96b1b12/Hospital%20Provider%20Cost%20Report%20Methodology_2024_508%20Approved.pdf`;
cms-hcris `https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report`; ahrq-meps
`https://meps.ahrq.gov/mepsweb/data_stats/download_data_files.jsp`.

Additive (ledger `additive_bindings`, no budget change; basis recorded; bound BEFORE fetching):
1. `https://data.cdc.gov/api/views/jqwm-z2g9` — Socrata view metadata for inventory ID jqwm-z2g9; same
   platform pattern as batch 1 PLACES/maternal/BRFSS navigation. Eligible API schema metadata. Row
   endpoints (`/resource/`) and bulk exports excluded, not fetched. Bound 15:27:10Z, before phase 1.
2. `https://www.shepscenter.unc.edu/download/26381/` — October 2023 website-update release notes linked
   from the retrieved closures page (“recent changes to our rural hospital closure and conversion
   website”); observed href carried an ephemeral `?tmstv=<epoch>` cachebuster, canonical path recorded.
   Same approved host. Eligible release notes. Bound 15:28:18Z, before phase 2.
3. `https://meps.ahrq.gov/mepsweb/survey_comp/household.jsp` — Household Component methodology page
   linked from the retrieved download-page navigation bar. Same approved host. Eligible methodology/access
documentation. Bound 15:28:18Z, before phase 2.
4. `https://meps.ahrq.gov/mepsweb/data_stats/data_overview.jsp` — Data Overview documentation page linked
   from the retrieved download-page navigation bar. Same approved host. Eligible access/methodology
   documentation. Bound 15:28:18Z, before phase 2.
5. `https://meps.ahrq.gov/mepsweb/survey_comp/survey_questionnaires.jsp` — Survey Questionnaires
   codebook-navigation page linked from the retrieved download-page navigation bar. Same approved host.
   Eligible codebook/methodology navigation. Bound 15:28:18Z, before phase 2.

Deliberately NOT fetched: Sheps `download/11619` closure-data file (bulk data file, operation exclusion);
Sheps findings briefs `download/24168` + `download/23647` (publications, outside this batch scope);
MEPS per-file PUF zips / contractor methodology PDFs (bulk-adjacent or referenced-only, see §4);
CDC VSRR infant technical-notes homepage `https://www.cdc.gov/nchs/nvss/vsrr/infant-mortality.htm`
(referenced in metadata; `www.cdc.gov` out of approved scope); CMS hospital/REH definition pages
(referenced in Sheps notes; `www.cms.gov` navigation not needed for this batch).

## Attempt summary (detail: ledger `attempts`, `receipts/`, `attempts/`)

| # | product_key | URL | result | HTTP | bytes (stored) | SHA-256 (short, filename) |
|---|---|---|---|---|---|---|
| 1 | sheps-closures | https://www.shepscenter.unc.edu/…/rural-hospital-closures/ | retrieved | 200 | 130,325 | 2761bce3 |
| 2 | cdc-infant | https://data.cdc.gov/d/jqwm-z2g9 → …/NCHS-VSRR-Quarterly-provisional-estimates-for-infa/jqwm-z2g9 | retrieved | 200 | 599,443 | e87e0c69 |
| 3 | cdc-infant-metadata | https://data.cdc.gov/api/views/jqwm-z2g9 | retrieved | 200 | 12,287 | e5e09b9b |
| 4 | cms-hcris-methodology | https://data.cms.gov/…/Hospital%20Provider%20Cost%20Report%20Methodology_2024_508%20Approved.pdf | retrieved | 200 | 124,591 | f0a16c7b |
| 5 | cms-hcris | https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report | retrieved (shell) | 200 | 2,974 | bf407f76 |
| 6 | ahrq-meps | https://meps.ahrq.gov/mepsweb/data_stats/download_data_files.jsp | retrieved (shell nav) | 200 | 40,372 | 227a6077 |
| 7 | sheps-release-notes | https://www.shepscenter.unc.edu/download/26381/ | retrieved | 200 | 209,535 | 6d5a0452 |
| 8 | meps-household | https://meps.ahrq.gov/mepsweb/survey_comp/household.jsp | retrieved | 200 | 47,719 | ccda2175 |
| 9 | meps-data-overview | https://meps.ahrq.gov/mepsweb/data_stats/data_overview.jsp | retrieved | 200 | 61,161 | 932d15b3 |
| 10 | meps-questionnaires | https://meps.ahrq.gov/mepsweb/survey_comp/survey_questionnaires.jsp | retrieved | 200 | 41,934 | f859b482 |

All redirects stayed on approved hosts (data.cdc.gov ×1). No out-of-scope, private-network, or
credentialed destinations encountered. No bulk files or row endpoints fetched. No failures this batch.

---

## 1. rural-hospital-closure-tracking — Sheps rural hospital closures (candidate → documented)

What it contains: the Sheps Center Rural Hospital Closures tracker. Counts observed 2026-09-17:
197 closures and conversions since January 2005 (109 complete + 88 converted); 154 since 2010
(86 complete + 68 converted). Conversions to Rural Emergency Hospitals are NOT counted in these totals.
Complete closure = facility no longer provides health-care services. Converted closure = facility no
longer provides inpatient services but continues other health services (primary care, SNF, LTC, urgent/
emergent, rehab, outpatient). Closure convention follows the HHS Office of Inspector General: a closed
hospital “stopped providing general, short-term, acute inpatient care.”
Cited: `captures/sheps-closures-20260917-2761bce3.html` (counts banner; definition anchors).

Where/when it applies: rural hospitals, United States. The embedded sortable table carries closure years
2005–2026 (197 data rows; 2 rows dated 2026 at retrieval). October 2023 definition/reported-scope change:
closure redefined from “no longer meets the CMS definition of a hospital (inpatient)” to “no longer meets
the CMS definition of a hospital OR a Rural Emergency Hospital”; REH conversions moved to a separate REH
website; the 10-5/10-6-2023 recount restated 201 (= 102 complete + 89 converted + 10 REH) as 191 with the
10 REH reported separately. REHs exist as a Medicare provider type since January 1, 2023.
Cited: closures page table (year range); `captures/sheps-release-notes-20260917-6d5a0452.pdf` pp.1–3
(creation 2023-10-17; recount; scenario table for 5 REH transitions; CMS hospital/REH definitions).

One-row grain: one row per closed/converted rural hospital — 197 data rows × 8 columns server-side:
Hospital, State, RUCA, CBSA, Medicare Payment, Closure Year, Number of Beds, Services Remaining.
Observed Medicare Payment values include PPS, CAH, MDH, SCH, IHS, REH (REH rows = closed REHs per the
scenario table: “open REH closes → added to closures list with Medicare payment stated as REH”).
Row-key uniqueness was NOT tested beyond counting rows against the banner total (197 = 197).
Cited: closures page sortable table (first row Sturgis Hospital / Michigan / 2026; last row Gulf Pines
Hospital / Florida / 2005 in current sort).

Useful variables: State; RUCA code (observed values e.g. 2, 4.0, 6, 7, 7.1, 9, 10); CBSA type
(Micro/Metro/Neither); Medicare Payment type; Closure Year; Number of Beds (0 observed for REH/converted
rows); Services Remaining free text (None / Outpatient services / Emergency Care / Rural Health Clinic …).
No separate dictionary page exists — the page + column headers ARE the schema. The bulk download
(`download/11619`) was NOT fetched per the bulk-file exclusion, so downloadable-file parity is unproven.
Cited: table headers + cell values; download-link href (presence only).

Access next step: the page is fully public, no account. MEDIA line asserts terms of use on the map data
and interview requests through the research team — reuse terms for the map/data beyond the page were NOT
verified. For analysis: pick complete vs converted (vs REH-site) handling explicitly, because the October
2023 split means pre/post-2023 totals are not comparable without the REH-site count.
Cited: MEDIA/terms line; release-notes recount box.

Proposed facts (gap labels; D=publisher_documented, O=ushso_observed, U=unknown):
- Population / entity [U → D]: “Rural hospitals with closure/conversion events since January 2005;
  complete (no health services) vs converted (inpatient closed, other services continue), OIG convention.”
- Geography [U → D]: “U.S. rural hospitals by State, with RUCA code and CBSA type per facility.”
- Period [U → D]: “Closure years 2005–2026 in the retrieved table; definition/scope break October 2023
  (REH split, 201→191 recount). Page currency stamp unresolved.”
- Grain [U → D]: “One row per closed/converted hospital: Hospital × State × RUCA × CBSA × Medicare
  Payment × Closure Year × Beds × Services Remaining (197 data rows 2026-09-17); row-key uniqueness
  not independently tested.”
- Cadence [U, keep]: “Update cadence unresolved (2 rows dated 2026 observed; no schedule stated).”
- Variables / dictionary [U → D]: “8-column inline schema documented (no separate dictionary); Medicare
  Payment values include PPS/CAH/MDH/SCH/IHS/REH; bulk-download parity unproven (file not fetched).”
- Access / cost / account [U → O]: “Public page, no account observed; map/data reuse terms + interview
  route asserted on page, not verified; bulk file excluded from this operation.”
- IDs / joins [U, keep]: “No facility identifier (CCN or otherwise) observed in the table; hospital-name
  joins unproven — explicitly do not join on name.”
- nextAction: point at the closures page + October 2023 update notes; require an explicit
  complete/converted/REH-handling decision before any count is cited.

Remains unknown/restricted: page currency/update schedule; bulk-download parity and format; map-data reuse
terms; facility identifiers for joins; REH-site counts needed for pre/post-2023 comparability.
Consequence: Sheps now supports DOCUMENTED closure-count scoping and table-grain design, but no time-series
spanning October 2023 and no facility-level join may be built until the REH-site count and an identifier
are resolved.

## 2. cdc-infant — CDC provisional infant mortality estimates (indexed)

What it contains: NCHS VSRR quarterly provisional estimates of infant mortality (deaths under 1 year per
1,000 live births), neonatal mortality (0–27 days), postneonatal mortality (28 days–11 months), plus death
rates for the five leading causes of infant death.
Cited: `captures/cdc-infant-metadata-20260917-e5e09b9b.json` — `$.description` (full text in receipt).

Where/when it applies: Geographic Coverage United States (national). Update Frequency R/P3M (quarterly
ISO repeating interval); Temporal Applicability 2023-01-01/2025-12-31 is the OBSERVATION window.
View dates: created 2016-11-21, publicationDate 2019-06-26, rowsUpdatedAt 2026-05-26 — all VIEW dates, not
observation dates; do not conflate. Suggested citation carries the `https://data.cdc.gov/d/jqwm-z2g9` locator.
Cited: metadata `$.metadata.custom_fields` (Data Quality + Common Core), `$.createdAt`,
`$.publicationDate`, `$.rowsUpdatedAt`.

One-row grain: estimate rows over Year and Quarter × Topic × Indicator carrying Time Period, Rate
(number), Unit, Significant flag, Standard Error (number), Footnote Symbol + Footnote — 10 columns.
Row-key uniqueness was NOT payload-tested.
Cited: metadata `$.columns` (10; fieldName/name/dataTypeName in capture).

Useful variables: the 10-column dictionary (retrieved); rate/unit/significance/standard-error semantics and
cause-of-death coding live in the VSRR technical notes
(`https://www.cdc.gov/nchs/nvss/vsrr/infant-mortality.htm` — REFERENCED in metadata, NOT fetched:
`www.cdc.gov` out of approved scope). Treat as navigation lead, not evidence.
Cited: metadata `$.columns`, `$.metadata.custom_fields.Common Core.Homepage`.

Access next step: choose Topic/Indicator + quarter inside the 2023–2025 window, then inspect the technical
notes for weighting/denominator/suppression. View metadata asserts public access level, license
USGOV_WORKS, contact cdcinfo@cdc.gov (NCHS); payload, terms, and rate limits NOT tested.
Cited: metadata `$.licenseId`, `$.metadata.custom_fields`.

Proposed facts (indexed labels; states: D=publisher_documented, O=ushso_observed, U=unknown):
- Population / entity [keep]: add “Infant (<1y), neonatal (0–27d), postneonatal (28d–11m) deaths and
  live-birth denominators; five leading causes of infant death.”
- Geography [U → D]: “United States (national coverage asserted in view metadata); state-level detail
  unresolved — payload coverage not checked.”
- Period [provisional, keep]: add “Quarterly provisional; observation window 2023-01-01/2025-12-31.
  View created 2016-11-21 / published 2019-06-26 / rows updated 2026-05-26 are view dates.”
- Grain [U → D]: “Estimate rows over Year and Quarter × Topic × Indicator carrying Time Period, Rate,
  Unit, Significant, Standard Error, Footnote (+ symbol) — 10-column layout retrieved 2026-09-17;
  row-key uniqueness not payload-tested.”
- Cadence [keep]: quarterly per R/P3M (schedule adherence not monitored).
- Variables / dictionary [keep, upgrade value]: “10-column dictionary retrieved 2026-09-17; cause coding
  and rate semantics require the (unfetched) VSRR technical notes.”
- Access / cost / account [O, keep state]: add “Metadata asserts public access, USGOV_WORKS, contact
  cdcinfo@cdc.gov; payload/terms/rate limits not tested.”
- IDs / joins [O, keep state]: add “Do not compare with maternal VSRR without aligning denominator
  (live births), period, geography, and provisional revision state.”
- nextAction: point at the api/views dictionary + technical-notes homepage for the requested slice.

dictionaryUrl candidate: `https://data.cdc.gov/api/views/jqwm-z2g9`
(`NCHS VSRR infant-mortality view metadata (10-column layout, retrieved 2026-09-17)`);
representativeVars candidate: Year and Quarter, Topic, Indicator, Rate, Standard Error;
evidenceLinks candidate: product page (`…/NCHS-VSRR-Quarterly-provisional-estimates-for-infa/jqwm-z2g9`,
capture cdc-infant-20260917-e87e0c69.html) + view metadata (capture
cdc-infant-metadata-20260917-e5e09b9b.json).

Remains unknown/restricted: per-indicator series bounds inside the window; suppression/weighting rules;
cause-of-death coding; technical-notes content (out-of-scope host); payload delivery/terms.
Consequence: infant-mortality work must pin Topic + Indicator + quarter inside 2023–2025 and budget a
separate technical-notes check — the view metadata gives layout, not rate methodology.

## 3. cms-hcris — CMS hospital cost reports (indexed flagship, methodology backing)

What it contains: the Hospital Provider Cost Report product page plus a 1-page PUF methodology PDF
(author Duff, Joseph (CMS/OEDA); created 2024-10-08). Medicare-certified institutional providers submit
annual cost reports carrying facility characteristics, utilization data, cost and charges by cost center
(in total and for Medicare), Medicare settlement data, and financial-statement data. CMS maintains the
data in HCRIS; hospitals file on form CMS-2552-10.
Cited: `captures/cms-hcris-methodology-20260917-f0a16c7b.pdf` (Data Source section; PDF metadata).

Where/when it applies: Medicare-certified institutional providers (hospitals for this product). No new
period evidence in this batch — the retained catalog window (2011-01-01–2023-12-31) stands. The PUF is an
unedited subset identical to the online HCRIS SAS dataset as of July 9, 2024.
Cited: PDF Variables Included section.

One-row grain: Aggregation Level is Hospital (methodology section header). Exact report-period row
semantics (one row per provider × fiscal-year-end) are NOT stated in this 1-page PDF — not asserted.
Cited: PDF Aggregation Level section.

Useful variables: field FAMILIES named (facility characteristics; utilization; cost/charges by cost
center total + Medicare; Medicare settlement; financial statements). This is NOT a dictionary: the PUF
carries only a subset of HCRIS variables, and the full variable list lives in the CMS-2552-10 instruction
manual, which was NOT fetched (out of this batch scope; record as navigation lead, not evidence).
Cited: PDF Data Source + Variables Included sections.

Access next step: open the CMS product page in a client (the server-side capture is an empty shell —
2,974 bytes: `Centers for Medicare & Medicaid Services Data` title, empty `#root`, noscript gate, JS
bundle refs only; no dataset facts or documentation links extractable server-side), select the exact
report period and fields, then verify current payload terms before retrieval.
Cited: `captures/cms-hcris-20260917-bf407f76.html`.

CONTRADICTION PRESERVED (scope): the product page returns HTTP 200 but carries ZERO server-side dataset
content — any server-side scrape of data.cms.gov product pages will see the same shell. Facts for this
profile must cite the methodology PDF (or a client-rendered inspection), never the shell HTML.

Proposed facts:
- Population / entity [keep]: add “Medicare-certified institutional providers filing annual cost reports
  on form CMS-2552-10, maintained in HCRIS.”
- Geography [keep]: no new evidence (provider-information naming stands; coverage unresolved).
- Period [keep]: retained 2011–2023 stands; add “PUF content identical to HCRIS SAS as of 2024-07-09.”
- Grain [U → D, bounded]: “Methodology asserts Aggregation Level: Hospital; per-period row semantics
  not stated in the retrieved PDF.”
- Cadence [keep]: no new evidence.
- Variables / dictionary [keep value, upgrade basis]: “Field families named in methodology (characteristics,
  utilization, cost/charges by cost center total+Medicare, settlement, financials); PUF is a SUBSET — full
  dictionary requires the CMS-2552-10 manual (not fetched).”
- Access / cost / account [O, keep state]: add “Product page is client-rendered (server shell observed
  2026-09-17); payload/terms/authorization untested.”
- IDs / joins [keep]: add “Form CMS-2552-10 as the filing instrument; CCN join keys still need source-side
  verification.”
- nextAction: open the product page in a client, pick period + fields, verify terms; consult the
  CMS-2552-10 manual for the full variable list.

dictionaryUrl candidate: the methodology PDF URL
(`Hospital Provider Cost Report Methodology 2024 (PUF scope + field families, retrieved 2026-09-17)`);
representativeVars candidate: none asserted at field level (families only — do NOT invent field names);
evidenceLinks candidate: product page (shell observed; capture cms-hcris-20260917-bf407f76.html) +
methodology PDF (capture cms-hcris-methodology-20260917-f0a16c7b.pdf).

Remains unknown/restricted: the full field dictionary (CMS-2552-10 manual); PUF-vs-full boundary per
variable; report-period row semantics; payload/terms/authorization.
Consequence: HCRIS can now be scoped (hospital grain, field families, PUF-subset caveat) but no
field-level comparison design may cite a dictionary until the CMS-2552-10 manual is pulled through an
authorized documentation step.

## 4. ahrq-meps — Medical Expenditure Panel Survey (gap, access/DUA documentation)

What it contains: the MEPS download hub plus three navigated documentation pages. MEPS has two major
release components — Household (HC; questionnaires to household members + their medical providers) and
Insurance/Employer (IC; survey of employers on plan information); in 1996 only, a Nursing Home Component
(restricted-only). HC yields nationally representative data on demographics, conditions, health status,
medical-care use, charges/payments, access, satisfaction, insurance, income, employment.
Cited: `captures/meps-data-overview-20260917-932d15b3.html`;
`captures/meps-household-20260917-ccda2175.html`.

Where/when it applies: national estimates (HC designed for them; MPC explicitly NOT for national
estimates). Page-revision stamps observed: download hub 2025-10-31; HC overview 2026-06-03;
questionnaires hub 2009-08-26. No panel/year currency asserted in this batch — file selection happens in
the JS-rendered file table, which was NOT retrievable server-side (1,598 text chars; nav only).
Cited: revision stamps in each capture; download-page shell finding.

One-row grain: unresolved at file level — but the documented FILE LEVELS are person, job, event, and
condition (PUFs ship at these levels with documentation + codebooks). Grain choice = file choice.
Cited: HC overview “Downloadable data files (person, job, event, or condition level)”.

Useful variables: no per-file dictionary retrieved (codebooks ship WITH the downloadable PUFs —
bulk-adjacent, not fetched). Navigation-grade resources documented: questionnaires hub (HC sections,
supplemental paper questionnaires, showcards; IC establishment questionnaires; MPC questionnaires +
contact guides + authorization forms), glossary, panel design, sample sizes, response rates, standard-error
computation, price indices, contractor methodology reports (PDFs referenced, not fetched), variable
explorer, summary tables, NHEA-aligned projected expenditures 2002–2016.
Cited: `captures/meps-questionnaires-20260917-f859b482.html`; HC/Data-Overview survey-basics lists.

Access next step (the core gain of this batch): a PUBLIC-USE vs RESTRICTED map, all publisher-stated:
public-use PUFs + documentation + codebooks downloadable online; HC restricted files → approved projects
at the AHRQ Data Center (Rockville, MD) or a Federal Statistical Research Data Center; MPC data →
Data-Center-only, editing/imputation use for HC, NO standalone files; IC → online tabular/tools only, NO
public data files (confidentiality), FSRDC research-version list-sample files for approved projects;
1996 NHC → restricted-only. NO cost, account, pricing, or DUA-execution terms are stated on any retrieved
page — DUA text itself was not retrieved. Authorization FORMS live under MPC questionnaires.
Cited: Data Overview component sections; HC overview restricted-files paragraph.

Proposed facts (gap labels):
- Population / entity [keep, extend]: “People/households/events/expenditures via HC; employer plan
  information via IC; providers appear only as HC editing/imputation inputs (MPC).”
- Geography [U, keep]: “National-estimate design asserted for HC; subnational availability unresolved.”
- Period [U, keep]: “Panel/year unresolved in this batch (revision stamps 2025-10-31 / 2026-06-03 /
  2009-08-26 observed, not data vintages).”
- Grain [U, keep with vocabulary]: “File levels person/job/event/condition; exact one-row-per-X per file
  requires the selected PUF codebook.”
- Cadence [U, keep]: “Release schedule page referenced, not fetched.”
- Variables / dictionary [U, keep]: “No per-file dictionary retrieved; codebooks ship with PUFs;
  questionnaire hub + variable explorer + glossaries are the documented on-ramps.”
- Access / cost / account [U → D(boundary)]: “Publisher-stated public-vs-restricted map documented
  (PUFs online; HC-restricted/MPC/IC-microdata/NHC-1996 via Data Center/FSRDC approved projects; IC
  tabular-only online). Cost/account/DUA-execution terms unresolved — DUA text not retrieved.”
- IDs / joins [U, keep]: “No person/event linkage keys documented in this batch.”
- nextAction: select panel/component + year in the file table (client), pull that PUF’s codebook +
  documentation, and route any restricted need through the Data Center/FSRDC approved-project path.

Remains unknown/restricted: per-file codebooks and universes; DUA text, cost, account, approval criteria;
panel/year currency; IC/MPC/NHC file-level detail.
Consequence: MEPS questions can now be ROUTED (public vs restricted, which component, which file level,
which docs to pull next) but no expenditure estimate design may proceed until the selected PUF codebook
is retrieved.

## Cross-cutting distinctions preserved

- Shell ≠ absence: data.cms.gov product pages (HCRIS, 2,974 bytes) and the MEPS download hub render
  client-side — HTTP 200 with empty `#root` carries no facts, but the underlying products are real (PDF
  methodology; JSP documentation tree). Socrata pages (infant, 2,655 text chars) are shells whose facts
  live in `api/views` metadata. Never cite shell HTML for dataset facts.
- Observation vs publication vs view-update: infant Temporal Applicability 2023–2025 ↔ view
  rowsUpdatedAt 2026-05-26; Sheps table years 2005–2026 ↔ October 2023 scope break; MEPS revision stamps
  (2025-10-31 / 2026-06-03 / 2009-08-26) ↔ unasserted panel years; HCRIS catalog window ↔ PUF
  SAS-as-of 2024-07-09.
- Schema ≠ access: all dictionaries/metadata document WHAT exists, never that USHSO retrieved a payload
  row. No successfully_tested state is claimed anywhere.
- ID ≠ join: hospital names (Sheps), form numbers (HCRIS), file levels (MEPS), Topic/Indicator (infant)
  are documented descriptors; zero cross-source joins proven.
- REH versioning caution: any rural-hospital time series spanning October 2023 must state the
  complete/converted/REH handling — pre/post-break totals are incomparable without the REH-site count.
- Exclusions honored: Sheps bulk download, MEPS PUF zips, Socrata row endpoints, out-of-scope hosts
  (www.cdc.gov, www.cms.gov references recorded as leads, not evidence). One `?tmstv` cachebuster
  stripped to canonical path with the observation recorded in the binding basis.
- Failures: none this batch (10/10 retrieved). Prior failures stand (SAHIE /data/id/ 404).

## Post-capture redaction (2026-09-17, before commit)

Push protection pattern: a third-party PUBLIC Mapbox token (Socrata page embed, public-key prefix with
signature omitted here) appeared EXACTLY once in `captures/cdc-infant-20260917-e87e0c69.html`, replaced
with `pk.REDACTED-THIRD-PARTY-PUBLIC-MAPBOX-TOKEN` (no finding depends on it). Receipt, attempt, and ledger
bind the redacted bytes (SHA-256 `c4d1a428e38bcde1…`, 599,443 bytes); original capture SHA-256 was
`e87e0c69bb75380e…` (599,489 bytes), preserved in the per-entry `redactions` note. Filename keeps the
original short hash as a stable name (batch 1 precedent). All other 9 captures had zero occurrences.
Batch byte total recomputed 1,270,387 → 1,270,341 (−46).

## Files changed (this batch; researchNavigator.ts untouched)

- `verification/research-program/evidence/documentation-enrichment-ledger.json` (10 attempts with
  excerpts/locators; 5 additive bindings; totals 28/100 requests, 9,738,457/104,857,600 bytes post-redaction)
- `verification/research-program/evidence/doc-enrichment-20260917/captures/` (10 new files: 6 HTML, 2 PDF, 2 JSON)
- `verification/research-program/evidence/doc-enrichment-20260917/receipts/` (10 new JSON)
- `verification/research-program/evidence/doc-enrichment-20260917/attempts/` (10 new JSON)
- `docs/research-program/doc-enrichment-batch2-20260917.md` (this file)
