# Track 1 coverage: reconciliation and evidence-supported first set

Track: `track1-missing-source-family-coverage`. Base: `78da769956e124898b39fb287cd5b018de9fa962`. Branch: `codex/ushso-track1-coverage-20260916`. Generation pinned: `live-2026-09-03-85b50522b420` (unchanged). Frozen `evaluation/research-program/cohorts.json` (`sha256 89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543`) is not modified. Frozen `packages/retrieval/fixtures/named-source-registry.v1.0.0.json`, `packages/connectors/src`, retrieval ranking, and coverage accounting artifacts are not modified.

Catalog membership does not prove payload access, authorization, schema, join compatibility, or fitness for a research question. No access is invented. No denominator is changed (100-product cohort, 3,434-record baseline, retrieval present denominator 3 / universe denominator 7, R01-R16 unaccepted).

## 1. Twelve-family reconciliation (ingestion vs metadata vs restricted vs excluded vs unsupported)

Machine-readable table: `evaluation/research-program/track1/coverage-reconciliation.v1.json` (evidence-bound with input SHAs).

| # | Family | Group | Catalog (fixture) | Current v1.2.0 records | Class |
|---|--------|-------|-------------------|------------------------|-------|
| 1 | HRSA AHRF | federal | not a member / not indexed | 0 | excluded |
| 2 | CMS NPPES | federal | not a member / not indexed | 0 | excluded |
| 3 | SAMHSA facility services | federal | not a member / not indexed | 0 | excluded |
| 4 | CMS T-MSIS/TAF | federal | not a member / not indexed | 0 | excluded + restricted workflow |
| 5 | CDC/ATSDR SVI | federal | not a member / not indexed | 0 | excluded |
| 6 | PHC4 | state (PA) | member, 2 record ids (fixture claim) | 0 | metadata (v1.1.0 source_asserted, offline, not live verified) + excluded from current generation |
| 7 | State APCD programs | state (MA pilot) | not a member / not indexed | 0 | excluded (application-gated) |
| 8 | State facility licensure | state (PA pilot) | not a member / not indexed | 0 | excluded |
| 9 | Rural hospital closure tracking (Sheps) | state/national list | not a member / not indexed | 0 | excluded |
| 10 | AHRQ HCUP | restricted | not a member / not indexed | 0 | excluded + restricted workflow |
| 11 | AHRQ MEPS | restricted | not a member / not indexed | 0 | excluded + mixed (public-use + restricted) workflow |
| 12 | AHA Annual Survey | restricted | not a member / not indexed | 0 | excluded + paid workflow |

Tally: ingestion in current generation **0/12**; metadata indexed in any generation **1/12** (PHC4, v1.1.0 only); metadata indexed in current generation **0/12**; restricted/paid/mixed workflows documented **4/12** (TAF, HCUP, MEPS, AHA); excluded from current generation **12/12**; unsupported protocol **0/12** (every family adapter port is inside its supported set; unknown ports produce a bounded extension task, never a scraper).

Retained evidence state for all twelve: locator `unverified_locator`, verified route `false`, payload success `false`, live HTTP `false` (`verification/research-program/evidence/named-intake-locator-summary.json`, `family-workflow-summary.json`). Source cards corpus-wide: 100 products incomplete, 0 research-ready, 0 payload samples, catalog-metadata-only (`verification/research-program/evidence/source-card-summary.json`).

Two fixture notes are preserved, not reconciled away. First, the named-source-registry fixture marks `pa-phc4` as `coverage_state: indexed` with two record ids, but the current-generation v1.2.0 corpus (3,434 records across `records-0001/2/3.jsonl`) contains zero `pa-phc4` records; the two ids resolve to v1.1.0 offline records that are `source_asserted`, `offline_fixture`, and `not_live_verified`. Second, the named registry gives state licensure a federal certification-context discovery URL while the state-families registry gives the Pennsylvania licensing page; both locators are retained above.

## 2. First set (documentation-first, evidence-supported, explicitly incomplete)

Scope rule: only families whose retained intake evidence supports a documentation-first card are included, and only as `status: incomplete` cards with unexecuted access steps. No payload, variable list, grain (AHRF), or verified route is claimed. Searchable entries are the JSON cards and packets below plus this page; they are **not** injected into the frozen corpus or generation.

### 2a. HRSA Area Health Resources Files (AHRF)

- Publisher: Health Resources and Services Administration (`hrsa.gov`, `data.hrsa.gov`).
- Authoritative documentation: <https://data.hrsa.gov/topics/health-workforce/ahrf>.
- Coverage: unknown in retained evidence (geographic scope, reporting period, and grain are not evidenced; county workforce files are documented as not yet indexed).
- Period: unknown (not evidenced; not inferred).
- Grain: unknown (explicitly `null`; generic tags are not a grain).
- Access route: publisher documentation via DCAT adapter port (`fixture_id: ahrf-dcat-inventory`); locator is unverified, route unverified, no payload sample, no live check. Steps are documented-not-executed and stop at any auth/application/agreement/payment/restricted boundary.
- Limitations: not indexed (0 current-generation records); county workforce files not yet indexed; catalog membership (false) proves nothing about payload.
- Variables / dictionary links: no variable list retained. Dictionary-adjacent link is the authoritative documentation page only; no variable is listed.
- Searchable entry: `evaluation/research-program/track1/hrsa-ahrf-source-card.json` (`ushso.source-card.v1`, `status: incomplete`).
- Downloadable evidence packet: `evaluation/research-program/track1/hrsa-ahrf-evidence-packet.json` (`ushso.research-example-packet.v1`: question `Find AHRF county workforce files`, product + why-needed, empty fields with unknown flag, unexecuted access steps, zero qualified joins, caveats, citations).

### 2b. Rural hospital closure tracking (Sheps Center)

- Publisher: Cecil G. Sheps Center for Health Services Research, University of North Carolina. Nongovernmental identity preserved; this is not a government registry.
- Authoritative documentation: <https://www.shepscenter.unc.edu/programs-projects/rural-health/rural-hospital-closures/> (methodology page).
- Coverage: Sheps Center national closure list (US scope as a nongovernmental list, not a government census).
- Period: dated closure lists (exact vintages unknown in retained evidence).
- Grain: closure-event list (`product_type: closure_tracking`); facility-level grain fields are not evidenced.
- Access route: publisher documentation via document adapter port (`fixture_id: sheps-closure-docs`, budget 1 request / 64 KiB); locator unverified, route unverified, no payload sample, no live check. Steps are documented-not-executed.
- Limitations: not indexed (0 current-generation records); CMS enrollment files are not a substitute for Sheps methodology; catalog membership (false) proves nothing.
- Variables / dictionary links: no variable list retained. Methodology-adjacent link is the authoritative page only; no variable is listed.
- Searchable entry: `evaluation/research-program/track1/rural-hospital-closure-source-card.json` (`ushso.source-card.v1`, `status: incomplete`).
- Downloadable evidence packet: `evaluation/research-program/track1/rural-hospital-closure-evidence-packet.json` (`ushso.research-example-packet.v1`: question `Sheps rural hospital closures`, product + why-needed, empty fields with unknown flag, unexecuted access steps, zero qualified joins, caveats, citations).

## 3. What was deliberately left out

The other ten families are reconciled in the table but receive no first-set card in this change: NPPES/SAMHSA/SVI have the same unverified-locator ceiling as AHRF but were deprioritized to keep the first set small; TAF/HCUP/MEPS/AHA already have restricted/paid workflow cards under `packages/connectors/source-registry/` and adding parallel cards would double-count them; PHC4/APCD/licensure are state-pilot scoped and PHC4 carries the v1.1.0-vs-v1.2.0 generation caveat above, so they need a state-intake follow-up rather than a first-set card here. Gaps per family are listed in `coverage-reconciliation.v1.json`.

## 4. Verification

- Browser QA (previously-failing retrieval questions, Chromium + Firefox, task-owned storage): `evaluation/research-program/track1/browser-qa.json` (before/after; denominators unchanged).
- Scoped checks: intake suites (`federal-source-intake`, `state-source-intake`, `restricted-routes`), retrieval workspace tests, web workspace tests, `npm run build`, `npm run cf:dry-run` (no deploy). See the structured report for SHAs and outcomes.
