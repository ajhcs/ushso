# Navigator enrichment before/after recount - 2026-09-17

Denominator (same throughout): 20 questions / 20 profiles / 201 fact rows.
Baseline commit: a9cb514 (PR 106). Enriched commit: b663bdc.
Mode: baseline (8 indexed + 12 gaps). Candidate mode: 10 indexed + 10 gaps (facts unchanged).

## Fact-state counts

| state | before | after | delta |
|---|---|---|---|
| publisher_documented | 53 | 76 | +23 |
| ushso_observed | 32 | 32 | 0 (batch1 +1, batch2 -1) |
| unknown | 113 | 90 | -23 |
| provisional | 2 | 2 | 0 |
| conflicting | 1 | 1 | 0 |
| successfully_tested | 0 | 0 | 0 (never claimed from docs alone) |
| profiles with >=1 unknown | 19 | 17 | -2 (SAHIE, infant now zero-unknown; maternal already was) |

## Per-profile unknowns (after: unknown/total)

hcris 2/10, chow 3/10, ltcf 3/10, sahie 0/10, places 1/10, maternal 0/10, infant 0/10, brfss 2/10,
hcup 8/10, meps 7/10, compendium 8/10, nppes 4/10, ahrf 2/10, samhsa 8/10, tmsis-taf 8/10, svi 8/11,
apcd 8/10, licensure 8/10, sheps 2/10, aha 8/10.

## Resolved unknowns (23)

Grain resolved: sahie, places, brfss, infant, hcris (bounded: Aggregation Level Hospital), sheps (197x8 table).
Maternal grain tightened to the retrieved 12-column layout.
AHRF: population, geography (CT dual-FIPS), period (FY releases), grain (county vs state files), cadence, variables (SOC table, rate formula, suppression).
NPPES: population (Type 1/2 + V2 family), period and cadence and access (observed file rhythm, public page).
MEPS: access boundary map (public PUFs vs Data Center/FSRDC restricted; cost/DUA terms still unresolved).
HCRIS: field families + PUF-subset caveat + Aggregation Level; full dictionary still requires the CMS-2552-10 manual.

## Clarified (not resolved) unknowns

Documented restrictions: HCUP/TAF applications + DUAs, AHA license + cost, APCD state DUAs, MEPS Data Center approval, Sheps map-reuse terms.
Preserved contradictions/failures: SAHIE /data/id/ 404 (canonical locator dead; timeseries endpoint replaces it), SVI name collision (hesitancy record is not SVI evidence), HCRIS product page is an empty client shell (cite the PDF, never the shell), MEPS download hub is a client shell (cite the JSP docs), October 2023 Sheps REH scope break (pre/post totals incomparable), PLACES release year vs observation years.

## Remaining blockers by group

Documentation: PLACES cadence + measure definitions (out-of-scope host), BRFSS series years + weighting, HCRIS CMS-2552-10 manual, MEPS per-file codebooks, AHRF full technical docs, Sheps page currency + bulk parity + facility IDs.
Payload: row delivery, live API terms, rate limits, and authorization for all enriched profiles (schema docs never prove access).
Restricted access: HCUP, TAF, AHA, APCD, MEPS-restricted (applications, DUAs, cost, accounts).
Human decision: state + facility-class choice (APCD, licensure), complete/converted/REH handling (Sheps), vintage + denominator selection per question.

## Documentation budget consumed

28/100 requests (batch1 17 + batch2 11), 9,738,457/104,857,600 bytes (~9.29 MiB). 0 retries. 72 requests and ~90.7 MiB remain for follow-ups.
