# Source-by-field baseline — 2026-09-17 (recalculated from current tree)

Source: `apps/web/src/data/researchNavigator.ts` at `a9cb5149132603fc3d5f90a0a429f962d583aaa1` (baseline mode, `ACTIVE_CATALOG.isCandidate=false`).
Original comparison retained: 20 questions / 20 profiles / 201 fact rows including 113 unknown / 19 profiles with at least one unknown.

## Recalculated counts (same denominator)

- Questions: 20 (`PRIORITY_RESEARCH_QUESTIONS.length === 20`).
- Profiles: 20 = 8 indexed + 12 named gaps (baseline). Candidate mode: 10 indexed + 10 gaps (AHRF + Sheps become documentation-first indexed; facts unchanged).
- Fact rows: 201 = 8 indexed × 10 (80) + 12 gaps × 10 + 1 collision fact (121).
- By state (baseline): publisher_documented 53 / ushso_observed 32 / unknown 113 / provisional 2 / conflicting 1 / successfully_tested 0.
- Profiles with ≥1 unknown: 19 (all except none — every gap has 8 unknowns; 7 of 8 indexed have at least one unknown; CMS LTCF period is documented but grain/cadence remain unknown, so all 8 indexed contribute; recount shows 19 because one indexed profile has no unknown? See per-field table — maternal still has provisional period, not unknown, but retains unknown access-adjacent qualified text; validator recount: 19).

Derivation: indexed defaults give Publisher/Product/Population/Variables as publisher_documented, Access/IDs as ushso_observed, Geography/Period/Grain/Cadence per `factStates`; gaps give Publisher/Product as documented?publisher_documented:ushso_observed and the remaining 8 fields unknown, plus 1 conflicting collision fact on SVI.

## Field inventory (20 profiles × 9 substantive fields)

Fields: Population/entity · Geography · Time coverage · Unit of observation (Grain) · Update cadence · Variables/dictionary · Access/cost/account · Identifiers/joins · Release identity/restrictions.

| profile | population | geography | period | grain (unit) | cadence | variables | access | ids/joins | release |
|---|---|---|---|---|---|---|---|---|
| cms-hcris (indexed) | documented | unknown | documented | unknown | unknown | documented (no dictionary) | observed-unverified | observed-unproven | unresolved |
| cms-chow (indexed) | documented | unknown | documented | unknown | unknown | documented (no dictionary) | observed-unverified | observed-unproven | unresolved |
| cms-ltcf (indexed) | documented | unknown | documented | unknown | unknown | documented (no dictionary) | observed-unverified | observed-unproven | documented period only |
| census-sahie (indexed) | documented | documented | documented | unknown | documented | documented (no dictionary) | observed-unverified | observed-unproven | 2006–2024 catalog window |
| cdc-places (indexed) | documented | documented | documented (release yr) | unknown | unknown | documented (no dictionary) | observed-unverified | observed-unproven | 2025 release; observation window unresolved |
| cdc-maternal (indexed) | documented | documented | provisional | documented | documented | documented + suppression | observed-unverified | observed-unproven | provisional flow |
| cdc-infant (indexed) | documented | unknown | provisional | unknown | documented (title-derived) | documented (no dictionary) | observed-unverified | observed-unproven | provisional flow |
| cdc-brfss (indexed) | documented | documented | unknown | unknown | unknown | documented (no dictionary) | observed-unverified | observed-unproven | unresolved |
| ahrq-hcup (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| ahrq-meps (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| ahrq-compendium (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| cms-nppes (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| hrsa-ahrf (gap→candidate indexed docs) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| samhsa-facility-services (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| cms-tmsis-taf (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| cdc-atsdr-svi (gap + conflicting) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown+conflicting | unresolved; collision preserved |
| state-apcd-programs (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| state-facility-licensure (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| rural-hospital-closure-tracking (gap→candidate indexed docs) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |
| aha-annual-survey (gap) | unresolved | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unresolved |

## Per-field disposition

- Supported by retained evidence: publisher/product/population for indexed (24 facts); geography for SAHIE/PLACES/maternal/BRFSS; period for HCRIS/CHOW/LTCF/SAHIE/PLACES; grain for maternal; cadence for SAHIE/maternal/infant; variables named (all indexed) + maternal suppression.
- Resolvable through authorized documentation retrieval: unit of observation, geography, cadence, period, variables/dictionary, access for most profiles (publisher docs exist); HCRIS methodology PDF, SAHIE API metadata, PLACES Socrata view metadata, BRFSS methodology, NPPES file layout, AHRF docs, N-SUMHSS docs, SVI docs, Sheps methodology, HCUP/MEPS/Compendium/AHA access pages.
- Requires payload inspection: exact row keys, denominator fields, measure grain for PLACES/SAHIE/BRFSS/VSRR; cannot be resolved by docs alone — docs establish schema, not successful access.
- Requires restricted access or human decision: HCUP application/DUA/cost; T-MSIS/TAF application/DUA; MEPS restricted vs public-use boundary; AHA license/cost; APCD state-specific DUA/cost; state licensure state+class choice; NPPES disallowed join confirmation.
- Conflicting or genuinely unavailable: SVI name collision (retained vaccine-hesitancy record is not SVI evidence); PLACES observation vs release year; VSRR provisional revision windows.

## Shared documentation with multi-profile reuse

- CMS data.cms.gov product-page pattern + HCRIS methodology PDF → HCRIS, CHOW, LTCF.
- CDC Socrata view metadata pattern (`api/views`) → PLACES, maternal, infant, BRFSS.
- Census API metadata pattern (`api.census.gov/data`) → SAHIE dictionary reuse.
- AHRQ trio (HCUP/MEPS/Compendium) → shared access/DUA language, distinct products.
- HRSA AHRF + Sheps candidate packets → already-indexed documentation-first pattern to extend.

## Prioritization (first batch ~6)

Relevance × severity × tractability × reuse: SAHIE (dictionary reuse, question-anchored), PLACES (release/vintage confusion), BRFSS (participating-jurisdiction limit), maternal VSRR (provisional/suppression already strong — small lift), NPPES (join-critical identifier), AHRF (candidate → documented upgrade). HCRIS/PLACES release questions must not block other enrichment: proceed on SAHIE/BRFSS/NPPES/AHRF/Sheps/MEPS in parallel.
