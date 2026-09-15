# Local site baseline — 2026-09-15

Candidate: `4ec0a1e6f4fcc35d19286d936cc0070c2ac40cc6`. Local wrangler `cf:dev` on `http://127.0.0.1:8787` after `npm run build`. Browser: HTTP client against workerd, not Chromium/Firefox/WebKit. NVDA/VoiceOver/JAWS untested. These are engineering observations, not R12/R13 participant evidence.

## Journeys inspected

1. Find a dataset: `POST /api/discover` `hospital cost report` returned 10 of 109 matches. First record: Hospital Provider Cost Report `obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17`. Why-match: title text matches hospital, cost, report.
2. Publisher / release / geography / grain: dataset JSON reports publisher CMS Data Catalog, rolling version, temporal coverage 2011-01-01–2023-12-31, spatial coverage **unknown**, payload_access **unknown**, cost **unknown**.
3. Access and schema evidence: retrieval instructions exist (2). Catalog-metadata check succeeded 2026-09-03. Freshness_state **overdue**. Payload check not attempted. Join state `none_known`.
4. Documented access route: crawler HTML and JSON bind `https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report` as publisher source. SourceSummary now emits a next action from that bound URL for every source, not only HCRIS.
5. Proposed join: JSON note "No cross-source identity or join route is inferred from catalog metadata alone." Crawler HTML does not yet surface join limitations.
6. Citation / evidence packet: search-receipt download exists in the SPA; crawler HTML includes record ID, evidence ID, generation, and research-boundary aside. SPA shell for `/search` is JS-only (653 bytes).
7. Empty / missing recovery: nonsense question returns 0 results (not evidence no source exists). Unknown dataset API 404 `dataset_not_found`. Unknown dataset HTML 404 "Dataset record not found | USHSO".

## Remaining visible defects

- Human `/search` HTML is an empty SPA shell. Crawlers and no-JS users do not see result cards, next actions, or empty-state copy on that route.
- Dataset crawler HTML still omits the new "Clear source action" / payload-check language; that copy is SPA-only after JS.
- Spatial coverage unknown and payload unknown are honest; the SPA must keep them from reading as complete access.
- Chromium/Firefox/WebKit and assistive technologies remain untested on this candidate.

## Fixes already in this candidate

- SourceSummary next action is generic, from bound publisher URL or typed missing-URL state.
- Result cards keep six `data-result-region` values, "Open access route", and "catalog membership is not payload access".
- Gold-bar source-action CSS.

Do not treat this baseline as R04/R12/R15 evidence.
