# Doc-enrichment batch 1 — 2026-09-17 (SAHIE, PLACES, BRFSS, maternal, NPPES, AHRF)

Operation `OP-DOC-ENRICH-20260917` under `AUTH-DOC-ENRICH-20260917` (valid 2026-09-17 to 2026-09-24).
Branch: `codex/ushso-navigator-enrich-20260917`. Collector: `scripts/research-program/run-doc-enrichment.mjs`
(validate passes; HEAD 0b57589 at start, ca79805 storage-layout commit landed mid-batch — layout conformed).
Ledger: `verification/research-program/evidence/documentation-enrichment-ledger.json`.
Evidence: `verification/research-program/evidence/doc-enrichment-20260917/{captures,receipts,attempts}/`.
Inventory: `docs/research-program/documentation-enrichment-inventory-20260917.md` (23 URLs) + 7 additive bindings below.
Baseline: `docs/research-program/source-field-baseline-20260917.md` (20/20/201: 53 documented / 32 observed / 113 unknown / 2 provisional / 1 conflicting).

This file is FINDINGS ONLY. `apps/web/src/data/researchNavigator.ts` was NOT edited.

## Budget accounting

Hard budget: 100 requests / 100 MiB total / 10 MiB per response / 30 s per request / max 2 concurrent
(1 per host) / max 2 redirect hops / 1 transient retry. Every request, redirect hop, and retry charged
BEFORE execution. No credentials, payment, accounts, or personal data.

| metric | used | limit | remaining |
|---|---|---|---|
| requests (incl. redirect hops + retries) | 17 | 100 | 83 |
| bytes stored | 8,468,116 (~8.08 MiB, after token redaction; 8,468,254 at capture) | 104,857,600 | 96,389,484 |
| retries consumed | 0 | 1 per request | — |
| max single response | 5,224,311 (Census data.json) | 10,485,760 | OK |
| concurrency | sequential (max 1 at a time; per-host 1) | 2 (1/host) | OK |
| redirect hops | 4 total (1 each on 4 product pages), all same-host in-scope | 2 per request | OK |
| private-network / credential rejections | 0 triggered (all URLs https, no userinfo, public hosts) | reject-before-follow | enforced |

Retrieval window: 2026-09-17T15:15:38Z – 15:18:00Z (13 attempts, all times in ledger + receipts).

## Intended URLs (all in ledger inventory or additive-bound before fetching; no guessing)

Initial (inventory, 6): census-sahie `https://api.census.gov/data/id/SAHIE`; cdc-places
`https://data.cdc.gov/d/i46a-9kgh`; cdc-maternal `https://data.cdc.gov/d/e2d5-ggg7`; cdc-brfss
`https://data.cdc.gov/d/5eh7-pjx8`; cms-nppes `https://download.cms.gov/nppes/NPI_Files.html`;
hrsa-ahrf `https://data.hrsa.gov/topics/health-workforce/ahrf`.

Additive (ledger `additive_bindings`, no budget change, all same approved host as parent; basis recorded):
1. `https://data.cdc.gov/api/views/i46a-9kgh` — Socrata view metadata for inventory ID i46a-9kgh; pattern
   embedded in the retrieved PLACES page (api/views/…/rows.json references). Eligible API schema metadata.
   Row endpoints (`/resource/`) and bulk exports excluded, not fetched.
2. `https://data.cdc.gov/api/views/e2d5-ggg7` — same Socrata pattern for maternal ID e2d5-ggg7.
3. `https://data.cdc.gov/api/views/5eh7-pjx8` — same Socrata pattern for BRFSS ID 5eh7-pjx8.
4. `https://api.census.gov/data.json` — retained corpus provenance locator for the SAHIE record
   (`obs:asset:census-api:api.census.gov-data-id-sahie-6e4b062e3c39ea95`); inventory /data/id/SAHIE 404'd.
   Eligible API catalog metadata.
5. `https://data.hrsa.gov/Content/Documents/topics/AHRF%20Definition.pdf` — Methods and Definition PDF
   linked from the retrieved AHRF page Documentation section. Eligible methodology.
6. `https://api.census.gov/data/timeseries/healthins/sahie/variables.json` — SAHIE dictionary
   (`c_variablesLink` from retrieved data.json entry, http→https). Eligible dictionary/schema metadata.
7. `https://api.census.gov/data/timeseries/healthins/sahie/geography.json` — SAHIE geography predicates
   (`c_geographyLink`, http→https). Eligible schema metadata.

## Attempt summary (detail: ledger `attempts`, `receipts/`, `attempts/`)

| # | product_key | URL | result | HTTP | bytes | SHA-256 (short) |
|---|---|---|---|---|---|---|
| 1 | census-sahie | https://api.census.gov/data/id/SAHIE | FAILED typed:http_error:http_404 | 404 | 0 | — |
| 2 | cdc-places | https://data.cdc.gov/d/i46a-9kgh → …/PLACES-County-Data-GIS-Friendly-Format-2025-releas/i46a-9kgh | retrieved | 200 | 960,317 | 0aa0e46b |
| 3 | cms-nppes | https://download.cms.gov/nppes/NPI_Files.html | retrieved | 200 | 6,827 | 8309e853 |
| 4 | cdc-maternal | https://data.cdc.gov/d/e2d5-ggg7 → …/VSRR-Provisional-Maternal-Death-Counts-and-Rates/e2d5-ggg7 | retrieved | 200 | 613,299 | 76b85329 |
| 5 | hrsa-ahrf | https://data.hrsa.gov/topics/health-workforce/ahrf → …/health-workforce/nchwa/ahrf | retrieved | 200 | 458,587 | ae2da48a |
| 6 | cdc-brfss | https://data.cdc.gov/d/5eh7-pjx8 → …/Behavioral-Risk-Factor-Surveillance-System-BRFSS-M/5eh7-pjx8 | retrieved | 200 | 611,228 | 2fa6728f |
| 7 | census-sahie-catalog | https://api.census.gov/data.json | retrieved | 200 | 5,224,311 | 8af42774 |
| 8 | cdc-places-metadata | https://data.cdc.gov/api/views/i46a-9kgh | retrieved | 200 | 313,099 | e4fe3f56 |
| 9 | hrsa-ahrf-definition | https://data.hrsa.gov/Content/Documents/topics/AHRF%20Definition.pdf | retrieved | 200 | 227,747 | 958bfbce |
| 10 | cdc-maternal-metadata | https://data.cdc.gov/api/views/e2d5-ggg7 | retrieved | 200 | 20,563 | 1cebff77 |
| 11 | cdc-brfss-metadata | https://data.cdc.gov/api/views/5eh7-pjx8 | retrieved | 200 | 21,413 | 4ed255dd |
| 12 | census-sahie-variables | https://api.census.gov/data/timeseries/healthins/sahie/variables.json | retrieved | 200 | 10,351 | f7437f89 |
| 13 | census-sahie-geography | https://api.census.gov/data/timeseries/healthins/sahie/geography.json | retrieved | 200 | 512 | 8c1b7a64 |

All redirects stayed on approved hosts (data.cdc.gov ×3, data.hrsa.gov ×1). No out-of-scope,
private-network, or credentialed destinations encountered. No bulk files or row endpoints fetched.

---

## 1. census-sahie — Census county health-insurance estimates (indexed)

What it contains: the SAHIE program's single-year health-insurance coverage estimates for all U.S.
counties by selected economic and demographic characteristics. SAHIE models combine American Community
Survey data with administrative records and Census 2020 data (partly CDC/DCPC-funded for NBCCEDP).
Cited: `captures/census-sahie-catalog-20260917-8af42774.json` — `$.dataset[329].description`.

Where/when it applies: county, state, and national estimate levels. County queries require a state
predicate; geography vintage reference date 2020-01-01.
Cited: `captures/census-sahie-geography-20260917-8c1b7a64.json` — `$.fips`
(us/010, state/040, county/050 requires state; wildcard state).
Estimate years 2006–2024 enumerated in the dictionary; catalog temporal 2006/2024.
Cited: `captures/census-sahie-variables-20260917-f7437f89.json` — `$.variables.YEAR`;
catalog `$.dataset[329].temporal`.
Catalog record modified 2021-04-12 is a CATALOG date, not an observation date — do not cite it as data vintage.

One-row grain: publisher schema defines county/state/national estimate records addressed by
GEOID (State+County FIPS) / STATE / COUNTY plus YEAR and demographic slices
(AGECAT × IPRCAT × RACECAT × SEXCAT); exact per-year row combinations require the year API response,
which was not retrieved. Schema documents the grain vocabulary, not payload delivery.
Cited: variables.json `$.variables.{GEOID,STATE,COUNTY,US,YEAR,AGECAT,IPRCAT,RACECAT,SEXCAT,GEOCAT}`;
geography.json `$.fips`.

Useful variables (39-variable dictionary retrieved): denominators NIPR_PT with NIC_PT (insured) /
NUI_PT (uninsured) / PCTIC_PT / PCTUI_PT percents, each with _MOE / _LB90 / _UB90 uncertainty;
descriptors AGECAT (7: under 65, 18–64, 40–64, 50–64, under 19, 21–64, 21–29), IPRCAT (6: all,
≤200/250/138/400% poverty, 138–400%), RACECAT, SEXCAT (+ *_DESC text); predicates for/in (FIPS),
time (datetime year, required).
Cited: variables.json `$.variables` (39 keys).

Access next step: open the timeseries endpoint from the catalog distribution
(`http://api.census.gov/data/timeseries/healthins/sahie`, use https) for the requested YEAR with
for/in predicates; catalog asserts accessLevel public + CC0 license but live API terms, rate limits,
and payload retrieval were NOT tested.
Cited: catalog `$.dataset[329].distribution / .accessLevel / .license`.

CONTRADICTION PRESERVED: the canonical identifier `https://api.census.gov/data/id/SAHIE`
(inventory URL, registry officialDiscoveryUrl, catalog `$.dataset[329].identifier`) returned
HTTP 404 on 2026-09-17 (attempt 1, typed:http_error:http_404). Do not route users to the /data/id/
landing page until re-verified; use data.json + timeseries endpoint + schema files.

Proposed facts (indexed labels; states: D=publisher_documented, O=ushso_observed, U=unknown):
- Population / entity [D]: add "Single-year health-insurance coverage estimates for all counties by
  selected economic/demographic characteristics; models combine ACS + administrative records + Census 2020."
- Geography [D, keep]: add "County (050, requires state predicate), state (040), national (010);
  geography vintage reference 2020-01-01. Payload coverage not checked."
- Period [D, keep]: keep 2006–2024; add "YEAR enum 2006..2024 in variables.json; catalog temporal 2006/2024."
- Grain [U → D]: "County/state/national estimate records keyed by GEOID/STATE/COUNTY + YEAR +
  AGECAT/IPRCAT/RACECAT/SEXCAT slices; exact per-year row combinations require the year API (not retrieved)."
- Cadence [D, keep]: annual model-based estimates (no change; release delivery not checked).
- Variables / dictionary [D]: upgrade value to "39-variable dictionary retrieved 2026-09-17
  (NIPR/NIC/NUI/PCTIC/PCTUI estimate+MOE+90% CI families; AGECAT/IPRCAT/RACECAT/SEXCAT; for/in/time
  predicates). Year-specific labels/universes still require the requested year's API."
- Access / cost / account [O, keep state]: add "Catalog asserts accessLevel public, CC0 license;
  live API authorization, rate limits, current terms, and payload retrieval not tested."
- IDs / joins [O, keep state]: add "GEOID (State+County FIPS), STATE, COUNTY, STABREV documented;
  joins require vintage/geography alignment; no cross-source join proven."
- nextAction: point at the timeseries endpoint + variables/geography schema, not the /data/id/ page.

Remains unknown/restricted: live API behavior (auth, limits, current terms); per-year label/universe
details; payload row delivery. Consequence: SAHIE work must start at the timeseries endpoint with an
explicit YEAR + for/in predicates and a fresh terms check — the old /data/id/ locator is dead.

## 2. cdc-places — CDC local chronic-condition estimates (indexed)

What it contains: model-based county-level estimates in GIS-friendly format, 2025 release, 40 measures.
Funded by RWJF with CDC Foundation; produced by CDC Division of Population Health. Sources: BRFSS
2023 (35 measures) or 2022 (5 measures collected biennially: all teeth lost, dental visits, mammograms,
colorectal screening, short sleep) + Census 2023 county population + ACS 2019–2023 or 2018–2022.
Cited: `captures/cdc-places-metadata-20260917-e4fe3f56.json` — `$.description` (full text in receipt).

Where/when it applies: this record is the COUNTY release; PLACES spans county/place/tract/ZCTA and
50 states + DC. Join with the Census 2023 county boundary file; an ArcGIS Online feature service exists.
Release (publication) 2025-12-04 (view publicationDate/rowsUpdatedAt); measure observation years are
2023/2022 per above — RELEASE YEAR ≠ OBSERVATION YEAR, preserve the distinction.
Cited: metadata `$.description`, `$.publicationDate / $.rowsUpdatedAt`, `$.name`.

One-row grain: county-grain WIDE view — 168 columns ≈ 6 geo/population keys + 40 measures × 4
(CrudePrev/AdjPrev/Crude95CI/Adj95CI). Keys: StateAbbr, StateDesc, CountyName, CountyFIPS,
TotalPopulation, TotalPop18plus (Census 2023). Row-key uniqueness was NOT payload-tested.
Cited: metadata `$.columns` (168; fieldName/name/dataTypeName/description per column in capture).

Useful variables: per-measure crude + age-adjusted prevalence + 95% CI text, e.g. ACCESS2 (lack of
insurance, 18–64), ARTHRITIS, BINGE, BPHIGH/BPMED, CANCER, CASTHMA, CHD, CHECKUP, CHOLSCREEN,
COLON_SCREEN (45–75, 2022), COPD, CSMOKING, DENTAL (2022), … (all 40 in capture). Denominators and
age bounds live in column descriptions. Formal measure definitions:
https://www.cdc.gov/places/measure-definitions/index.html — REFERENCED in metadata but NOT fetched
(www.cdc.gov out of approved scope); treat as navigation lead, not evidence.
Cited: metadata `$.columns[*].{fieldName,name,description}`, `$.metadata.custom_fields`.

Access next step: inspect the release dictionary (captured) + measure definitions, confirm the exact
measure/denominator/geography vintage, then use the current payload route. View metadata asserts
license PUBLIC_DOMAIN, contact places@cdc.gov; payload, terms, and rate limits NOT tested.
Cited: metadata `$.licenseId / $.metadata.custom_fields.Common Core`.

Proposed facts:
- Population / entity [D]: add "Model-based estimates, 40 measures; BRFSS 2023/2022 + Census 2023 pop + ACS."
- Geography [D, keep]: add "County release of a 4-level system; join key CountyFIPS to Census 2023 county boundaries."
- Period [D, keep]: rewrite "2025 release (published 2025-12-04); measure observations 2023 (35 measures) /
  2022 (5 biennial measures). Source observation period per measure is in column descriptions."
- Grain [U → D]: "County-grain wide view (168 columns: 6 keys + 40 measures × Crude/Adj Prev + 95% CI);
  row-key uniqueness not payload-tested."
- Cadence [U, keep]: "Release cadence not stated in view metadata (rowsUpdatedAt 2025-12-04 observed)."
- Variables / dictionary [D]: "168-column dictionary retrieved 2026-09-17; pattern
  <MEASURE>_{CrudePrev,AdjPrev,Crude95CI,Adj95CI}; denominators in descriptions; formal measure
  definitions require the (unfetched) CDC measure-definitions page."
- Access / cost / account [O, keep]: add "Metadata asserts PUBLIC_DOMAIN, contact places@cdc.gov;
  payload/terms/rate limits not tested."
- IDs / joins [O, keep]: add "CountyFIPS (+ StateAbbr); boundary vintage 2023 required; no join proven."

Remains unknown/restricted: release cadence; payload delivery/terms; formal measure definitions
(out-of-scope host). Consequence: county mapping must pin measure + denominator + 2023 boundary vintage
and budget a separate definitions check.

## 3. cdc-brfss — CDC adult behavioral-health survey indicators (indexed)

What it contains: BRFSS telephone-interview estimates of mental-health experiences/behaviors/conditions
among U.S. adults. System covers 50 states + DC + Guam/PR/VI, but THIS product reports PARTICIPATING
JURISDICTIONS ONLY — nationwide estimates are not available.
Cited: `captures/cdc-brfss-metadata-20260917-4ed255dd.json` — `$.description`.

Where/when it applies: state unit of analysis (metadata Geographic Unit of Analysis: State); view
created 2025-05-02, rows updated 2026-01-28. A Year column exists but SERIES BOUNDS ARE UNRESOLVED in
metadata — observation vs publication dates must not be conflated.
Cited: metadata `$.columns` (Year), `$.createdAt / $.rowsUpdatedAt / $.publicationDate`,
`$.metadata.custom_fields.Data Quality`.

One-row grain: estimate rows over Year × Question × Area(/Abbr) × Demographics_Type/Value carrying
Percent (1-decimal) + Low/High 95% CI + formatted CI + Data_Label + Percentile_Range (12 columns);
row-key uniqueness NOT payload-tested.
Cited: metadata `$.columns` (12; names/descriptions in capture).

Useful variables: the 12-column dictionary (retrieved); question/denominator/weighting/suppression
detail lives in BRFSS methodology, NOT in this view — see
https://www.cdc.gov/mental-health/about-data/mental-health-data-sources.html (referenced, not fetched).
Cited: metadata `$.columns`, `$.description` (additional-information link).

Access next step: choose indicator + year, then inspect BRFSS weighting/denominator/suppression docs.
Contact mentalhealthdata@cdc.gov; suggested citation in metadata; payload/terms/rate limits NOT tested.
Cited: metadata `$.metadata.custom_fields`.

Proposed facts:
- Population / entity [D, keep + extend]: "U.S. adults via telephone interviews; mental-health
  indicators for participating jurisdictions."
- Geography [D, keep]: add "State unit; participating jurisdictions only; no nationwide estimates."
- Period [U, keep]: "Year column present; series bounds unresolved in metadata (view updated 2026-01-28)."
- Grain [U → D]: "Estimate rows by Year × Question × Area × Demographics_Type/Value with Percent + 95% CI
  (12 columns); uniqueness not payload-tested."
- Cadence [U, keep]: "Continuous state-based surveillance described; publication cadence not stated."
- Variables / dictionary [D]: "12-column dictionary retrieved 2026-09-17; survey questions, weighting,
  denominators, suppression require BRFSS methodology (unfetched)."
- Access / cost / account [O, keep]: add "Contact + citation observed; payload/terms/limits not tested."
- IDs / joins [O, keep]: "Area/Area_abbr state identifiers; no facility-directory join without aligned
  geography/period/population/weighting."

Remains unknown/restricted: series years present; weighting/denominator/suppression rules; cadence.
Consequence: any state prevalence claim must name year + question + demographic slice and carry the
participating-jurisdiction caveat.

## 4. cdc-maternal — CDC provisional maternal mortality estimates (indexed)

What it contains: national-level PROVISIONAL maternal death counts and rates per 100,000 live births
from the NVSS current flow; 12-month-ending rates overall, by age, and by race/Hispanic origin.
Maternal death = death while pregnant or within 42 days of termination (any cause related to/aggravated
by pregnancy, excl. accidental/incidental); ICD-10 A34, O00–O95, O98–O99.
Cited: `captures/cdc-maternal-metadata-20260917-1cebff77.json` — `$.description`, `$.columns`.

Where/when it applies: national, occurrence jurisdiction; 12-month-ending periods (e.g. June 2020 =
Jul 2019–Jun 2020); compare YEAR-TO-YEAR not month-to-month (overlapping windows). Data-as-of dating
per release; view rows updated 2026-07-16. Provisional values revise quarterly as records arrive.
Cited: metadata `$.description` (trend + revision paragraphs), `$.columns`
(Data As Of, Year/Month of Death, Time Period, Month Ending Date), `$.rowsUpdatedAt`.

One-row grain (already D; confirmed + tightened): 12-month-ending estimate rows by
Jurisdiction × Group/Subgroup (demographic) × 12-month-ending year/month/date carrying Maternal Deaths,
Live Births (12-month-ending denominator), Rate, Footnote. Exact API row keys unverified.
Cited: metadata `$.columns` (12 columns enumerated in receipt).

Useful variables: Maternal Deaths / Live Births / Maternal Mortality Rate + Footnote (suppressed 1–9);
suppression: counts 1–9 (confidentiality) and rates on <20 deaths (NCHS reliability) suppressed.
Suggested citation DOI 10.15620/cdc/20250305011. Technical notes:
https://www.cdc.gov/nchs/nvss/vsrr/provisional-maternal-deaths.htm (referenced, NOT fetched).
Cited: metadata `$.columns` (Footnote), `$.description`, `$.metadata.custom_fields`.

Access next step: read the technical notes for the requested release; preserve provisional label +
revision/date in all downstream use. Payload/rate inputs/terms NOT tested (no change).
Cited: metadata `$.metadata.custom_fields.Common Core` (contact cdcinfo@cdc.gov).

Proposed facts (small lift on an already-strong profile):
- Geography [D, keep]: add "Jurisdiction = occurrence; national-level rates."
- Period [provisional, keep]: add "12-month-ending periods with Data As Of dating; revised quarterly;
  compare year-to-year."
- Grain [D, keep]: tighten to the 12-column layout above.
- Cadence [D, keep]: "Quarterly updates + revisions (rowsUpdatedAt 2026-07-16 observed)."
- Variables / dictionary [D]: add "12-column layout retrieved; ICD-10 A34/O00–O95/O98–O99;
  suppression 1–9 counts / <20-death rates; citation DOI."
- Access / IDs [O, keep]: no change except occurrence-jurisdiction note; never join to infant/facility
  data without aligning denominator/period/geography/revision.

Remains unknown/restricted: payload-row delivery; exact API keys. Consequence: none blocking — this
profile is citation-ready provided the provisional + revision caveats travel with every number.

## 5. cms-nppes — National Plan and Provider Enumeration System (named gap)

What it contains (program vs product): NPPES is the enumeration SYSTEM (program); this page is the
NPI Downloadable File PRODUCT route: Monthly NPPES Downloadable File V2 + Monthly NPI Deactivation
File V2 + Weekly Incremental V2. Each zipped file bundles 3 reference files: Other Name (additional
names, Type 2), Practice Location (non-primary locations, Type 1 + 2), Endpoint (Type 1 + 2).
A "Data Dissemination File – Readme" holds field detail but ships INSIDE the zips.
Cited: `captures/cms-nppes-20260917-8309e853.html` — h1#npi-files, Important-info (V1 end 03/03/2026),
reference-file list, section ids monthy-v2 / monthy-npi-deactivation-v2 / weekly-incremental-npi-v2.

Where/when it applies: current V2 files observed 2026-09-14 (monthly dissemination + deactivation) and
weekly window 090726–091326; V1 monthly/weekly ends 03/03/2026 (V2 extended First/Legal-Business-Name
lengths). Provider practice-location geography and enumeration-period coverage are NOT stated on the
page — unresolved.
Cited: same capture (dated file links + effective-date notice).

One-row grain: NOT established from this page. Page implies enumeration records (Type 1 individual /
Type 2 organizational via reference-file text) plus one row per other-name / non-primary location /
endpoint in the reference files — but counts, keys, and readme field specs were not retrieved.
Do NOT infer. Proposed Grain stays U with this qualified value.

Useful variables: NO field dictionary retrieved. Named file-level objects only (3 reference files +
deactivation file + readme mention). Taxonomy, address, identifier, and status fields REQUIRE the
readme inside the (excluded) bulk zips or a separately authorized dictionary pull.
Cited: capture reference-file list; absence of readme href (only css/subscribe/cms.gov-education-pdf/
mailto/in-page hrefs present).

Access next step: open the NPI Files page, then obtain the Data Dissemination Readme + file-layout
terms through CMS's documented route BEFORE planning any NPI/taxonomy/address join. Observed page
links direct V2 ZIPs (monthly ~1,105.79 MB — bulk, NOT retrieved per operation exclusion); subscribe
link points at nppes.cms.hhs.gov (out-of-scope host, not followed); contact
customerserviceNPIenumerator@cms.hhs.gov listed. Current terms/cost/account/rate limits unverified.
Cited: capture file-link list (sizes), subscribe href, mailto.

Proposed facts (gap labels; D=publisher_documented, O=ushso_observed, U=unknown):
- Publisher / operator [D, keep]: no change.
- Product [D, keep]: extend "NPI Downloadable File V2 family (monthly, weekly incremental, monthly
  deactivation) + 3 reference files per zip."
- Population / entity [U → D]: "Individual (Type 1) and organizational (Type 2) providers with NPI
  enumeration records (types per reference-file text)."
- Geography [U, keep]: "Practice-location records exist (non-primary file named) but geographic
  coverage is unresolved on this page."
- Period [U → O]: "Current-file dating observed (monthly 2026-09-14; weekly 090726–091326; V1 ends
  03/03/2026); enumeration coverage window unresolved."
- Grain [U, keep]: "Enumeration + reference rows implied; exact one-row-per-X grain not asserted."
- Cadence [U → O]: "Monthly + weekly-incremental + monthly-deactivation file rhythm observed on page;
  publication schedule adherence not tested."
- Variables / dictionary [U, keep]: "No dictionary retrieved; readme ships inside excluded bulk zips;
  taxonomy/address/identifier fields unconfirmed."
- Access / cost / account [U → O]: "Public file page with direct V2 links observed; terms, cost,
  account, rate limits unverified; bulk files not retrieved (operation exclusion)."
- IDs / joins [U, keep]: "NPI enumeration referenced (Type 1/2); taxonomy/address keys unconfirmed;
  NPI=CCN-style merges explicitly unproven — no join attempted."

Remains unknown/restricted: the entire field dictionary (readme-in-zip); join keys; terms/cost/account.
Consequence: NPPES CANNOT yet support an identity-join design — the next authorized step must be readme
retrieval through CMS terms, not a bulk download.

## 6. hrsa-ahrf — HRSA Area Health Resources Files (named gap → candidate docs)

What it contains: county/state/national health-workforce + resources files built from 50+ sources.
The dashboard (page) is a SUBSET; full county-level + national/state-level AHRF data files + technical
documentation live at the HRSA download route. County file ≠ state file sources.
Cited: `captures/hrsa-ahrf-20260917-ae2da48a.html` (Description: 50+ sources; county/state/national;
AHRF Year / profession / population / location filters);
`captures/hrsa-ahrf-definition-20260917-958bfbce.pdf` p.1 (Underlying Data; subset statement; download URL).

Where/when it applies: county, state, national. Annual release by BUREAU FISCAL YEAR (Oct 1–Sep 30 of
development); per-variable data years DIFFER within a release (2024–2025 release: county MD/dentist
thru 2023 AMA/ADA; county NP thru 2024 NPI; county pop thru 2024 Census; state file thru 2023 ACS PUMS).
Dashboard displays CALENDAR year; year select observed 2024…2019; dashboard data-as-of 01/29/2026.
CONNECTICUT: OMB-2022 nine planning regions replaced eight counties; Census sources use the nine,
other sources still use the eight; FILES carry both FIPS schemes; dashboard uses the nine since 2025.
Cited: PDF p.1 (release-year + example), pp.1–2 (Connecticut), p.2 (calendar-year table), page (year select).

One-row grain: two file grains — COUNTY-level file (MD incl. all-MD county view observed; dentist,
nurse, PA) vs STATE-level file (chiropractor, hygienist, …). Dashboard filters year × profession
type/category × population type/category × location. County sums do NOT equal state/national counts
(different sources) — explicit non-additivity.
Cited: page (County Level File vs State Level File profession labels); PDF p.1 (non-equality warning).

Useful variables: county sources AMA (MD/DO, incl. active/inactive, M.D./D.O. strata), ADA (active
licensed dentists), CMS NPI/NPPES (nurses, PAs); population from Census estimates/characteristics/SAIPE.
State file: ACS 5-Year PUMS, SOC 2018 codes (table p.6: PAs 29-1071, RNs 29-1141, LPN/LVN 29-2061,
hygienists 29-1292, pharmacists 29-1051, chiropractors 29-1011, optometrists 29-1041, psychologists
19-3033/34/3X, social workers 21-102x + NAICS medical-setting filter, PT 29-1123, OT 29-1122, respiratory
29-1126, speech 29-1127, dietitians 29-1031, EMT 29-2042/paramedic 29-2043); workforce = 16+ worked in
last 5 years; clinician rate = count/pop × 100,000. Suppression: state PRSE>30% → NA; county
unavailable/suppressed → NA.
Cited: PDF pp.3–6 (definitions, SOC table, suppression, rate formula); page (profession list).

Access next step: open the AHRF page → download route
https://data.hrsa.gov/data/download?data=AHRF#AHRF (linked on page + PDF p.1; NOT fetched — bulk-adjacent
route, needs its own terms check), identify the exact dated file + technical documentation, follow HRSA
terms. Current cost/account/terms unverified; dashboard export (PDF/XLSX) observed but not executed.
Cited: page Documentation/Download sections; PDF p.1.

Proposed facts (gap labels):
- Publisher / operator [O→D]: HRSA/Bureau of Health Workforce documented as AHRF publisher (page + PDF).
- Product [O→D]: "AHRF county-level + national/state-level data files + Clinician Dashboard subset
  (documentation-first; no payload indexed)."
- Population / entity [U → D]: "County/state/national health-workforce + resources entities; county
  professions (MD/DO, dentists, nurses, PAs) and state SOC-coded professions enumerated in methodology."
- Geography [U → D]: "County, state, national; CT dual-scheme FIPS (8 counties + 9 planning regions)."
- Period [U → D]: "Annual FY releases; per-variable years differ (see 2024–2025 example); dashboard
  calendar-year view; year select 2024…2019 observed 2026-09-17."
- Grain [U → D]: "County-level file vs state-level file; dashboard year×profession×population×location
  slices; county sums ≠ state/national (different sources)."
- Cadence [U → D]: "Annual release by Bureau of Health Workforce (FY-dated)."
- Variables / dictionary [U → D]: "Profession definitions + state SOC table + rate formula + suppression
  rules documented (PDF pp.3–6); full file technical documentation at download route (not retrieved)."
- Access / cost / account [U, keep]: "Official page + download route retained; terms/cost/account/download
  terms unverified, not executed."
- IDs / joins [U, keep]: "County/state FIPS (both CT schemes) are the documented geographic keys; no
  cross-source join proven; county↔state aggregation explicitly invalid."

Remains unknown/restricted: full file layouts (technical documentation at download route); terms/cost/
account; payload rows. Consequence: AHRF is now DOCUMENTED enough for release/field scoping and CT-safe
geography design, but no workforce join or count may be cited until the dated file + tech docs are pulled
through HRSA terms.

## Cross-cutting distinctions preserved

- Program vs product: NPPES (system) vs NPI Downloadable V2 files; SAHIE (program) vs timeseries
  endpoint + yearly slices; PLACES (system) vs 2025 county GIS release; BRFSS (system) vs Mental Health
  Indicators product; AHRF (files) vs Clinician Dashboard (subset).
- Observation vs publication year: PLACES 2025 release ↔ 2023/2022 observations; maternal rowsUpdatedAt
  2026-07-16 ↔ 12-month-ending observation windows; BRFSS view updated 2026-01-28 ↔ unresolved series
  years; SAHIE catalog modified 2021-04-12 ↔ 2006–2024 estimates.
- Schema ≠ access: all dictionaries/metadata document WHAT fields exist, never that USHSO retrieved a
  payload row. No successfully_tested state is claimed anywhere.
- ID ≠ join: GEOID/CountyFIPS/Area/NPI/FIPS keys are documented identifiers; zero cross-source joins proven.
- Failures retained: SAHIE /data/id/ 404; NPPES readme-in-zip unretrieved; CDC measure-definitions and
  mental-health source pages unfetched (out-of-scope hosts); HRSA download route unfetched
  (bulk-adjacent, needs terms check).

## Post-capture redaction (2026-09-17, before push)

Push protection flagged a third-party PUBLIC Mapbox token (Socrata page embed, public-key prefix with signature omitted here) in the three Socrata HTML captures. Each file had exactly one occurrence, replaced with `pk.REDACTED-THIRD-PARTY-PUBLIC-MAPBOX-TOKEN` (no finding depends on it). Receipts, attempts, and the ledger now bind the redacted bytes; original capture SHAs were `0aa0e46b4a2814cb…` (PLACES), `76b8532995db…` (maternal), `2fa6728f4ffa…` (BRFSS), preserved in per-entry `redactions` notes. Byte total recomputed 8,468,254 → 8,468,116. Filenames keep their original short hashes as stable names.

## Files changed (this batch; researchNavigator.ts untouched)

- `verification/research-program/evidence/documentation-enrichment-ledger.json` (13 attempts with
  excerpts/locators; 7 additive bindings; totals 17/100 requests, 8,468,116/104,857,600 bytes post-redaction)
- `verification/research-program/evidence/doc-enrichment-20260917/captures/` (12 files: 5 HTML pages,
  1 PDF, 6 JSON)
- `verification/research-program/evidence/doc-enrichment-20260917/receipts/` (13 JSON)
- `verification/research-program/evidence/doc-enrichment-20260917/attempts/` (13 JSON)
- `docs/research-program/doc-enrichment-batch1-20260917.md` (this file)
