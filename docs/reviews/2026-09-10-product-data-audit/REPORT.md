# USHSO product and data audit — September 10, 2026

Publication copy: findings are unchanged; local capture links resolve through [the retained evidence index](LOCAL-EVIDENCE.md). Raw bodies and screenshots have not been uploaded. The original report hash is recorded in that index.

USHSO has a useful discovery interface, stable catalog identities, substantial captured documentation, and working machine transports. It is not yet a dependable research navigator. Most records describe where a catalog entry exists; they do not establish how to query the underlying data, which release a dictionary describes, or whether the source answers a research question. Improving that distinction is the central engineering task.

This is a new audit of the live service. It does not treat an earlier release receipt, passing unit tests, or the existence of a schema as proof of current data usability. The proposed execution package is [the master plan](../../master-plan/2026-09-10/MASTER-PLAN.md).

## Subject and evidence

- Origin: `https://ushso.org`, inspected September 10, 2026, approximately 13:53–14:02 UTC, with a final state-readiness artifact check at 14:44 UTC; timestamps on individual captures take precedence.
- Published catalog: `live-2026-09-03-85b50522b420`, manifest identity `85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e`.
- All three live canonical metadata shards were downloaded and profiled: **3,434 unique record IDs**. Their bytes match the retained release source at commit `11b268c17b5b65261041734abca456720b0d9706`. This establishes corpus equality, not independent identification of the deployed Worker binary.
- The active workspace starts at `e93ac2b` and has extensive pre-existing changes; its cached `origin/main` is also older than the release recorded in the host notes. These files were preserved. Neither that workspace nor its cached remote was substituted for the current product.
- **28 live discovery questions**, ten top-level pages, search/detail/dictionary/pagination journeys, desktop 1440px and mobile 390px/320px checks; eight actual stdio MCP invocations and eight native Chrome WebMCP invocations.
- **2,905 dictionary descriptors and 34,081 dictionary pages** were read and hash-checked from the retained release assets. Three live dictionary responses match their retained descriptor hashes. This is a full offline dictionary profile plus a live sample, not a new traversal of every dictionary page through production.
- Three bounded publisher-data requests: one CMS row, one CDC row, and one Census aggregate query. This is not a live test of every upstream endpoint.

The [HTTP receipt ledger](LOCAL-EVIDENCE.md#evidence-http-receipts-json) retains request parameters, observed status, MIME-related headers, final URL, decoded-body hash, byte count, timestamp, and elapsed time. [The full profile](LOCAL-EVIDENCE.md#evidence-completeness-json), [per-record CSV](LOCAL-EVIDENCE.md#evidence-record-completeness-csv), [per-record dictionary completeness](LOCAL-EVIDENCE.md#evidence-dictionary-completeness-csv), [query results](LOCAL-EVIDENCE.md#evidence-queries-summary-json), [browser record](LOCAL-EVIDENCE.md#evidence-browser-json), [journey checks](LOCAL-EVIDENCE.md#evidence-journeys-json), [MCP record](LOCAL-EVIDENCE.md#evidence-mcp-stdio-json), and [native WebMCP record](LOCAL-EVIDENCE.md#evidence-webmcp-native-json) support the findings below. Capture scripts and [reproduction instructions](README.md) are alongside this report.

## What “filled out” currently means

The unit counted below is a catalog record, not a unique database, API, independent study, release, or usable dataset. Repeated titles do not by themselves identify duplicate data.

| Dimension | Current measured state | Research consequence |
|---|---:|---|
| Published / searchable records | 3,434 / 3,430 | Four records are isolated; public counts distinguish this |
| Publishers represented | CMS 159; CDC 1,472; Census 1,803 | This is three catalog enumerations, not comprehensive US health-systems coverage |
| Unique record IDs | 3,434 | Technical identity is populated |
| Nonempty descriptions | 3,430 / 3,434 | Descriptions exist, but their relevance and scientific sufficiency vary |
| Exact-title repetitions beyond the first | 579 | Family, release, and alias navigation is needed; automatic merging would be unsafe |
| Documented access mechanism | 0 / 3,434 | All have `mechanisms=[unknown]` |
| Preferred retrieval interface known | 0 / 3,434 | Every canonical recipe has `preferred_interface=unknown` |
| Machine-actionable canonical recipe | 0 / 3,434 | All are `false` |
| Known canonical geographic coverage | 0 / 3,434 | All have unknown coverage level and empty jurisdiction lists |
| Canonical time bounds populated | 996 / 3,434 (29.0%) | 2,438 lack bounds; populated bounds still require date-role and release interpretation |
| Known temporal granularity | 559 / 3,434 (16.3%) | An API release year is not automatically the observation period |
| Join routes / join keys | 0 / 0 | No published cross-source join mapping |
| Review deadlines already passed | 3,434 / 3,434 | All were due September 5; live responses still report “within review window” |
| Packaged dictionary proposals | 2,905 / 3,434 (84.6%) | 529 have no packaged dictionary; this does not prove publisher absence |
| Dictionary release/schema applicability resolved | 0 / 2,905 | The fields cannot yet be treated as a verified schema of the requested distribution |
| Record-scoped dictionary entries | 1,573,847 | Not 1.57 million unique variables or validated measurements |
| Nonempty field descriptions | 15,737 / 1,573,847 (1.0%) | Description presence is itself weaker than an adequate definition |
| Explicit measurement units | 0 | Some fields need `not_applicable`; measured variables need supported units |
| Entries with literal allowed values | 450,986 | Useful material exists and should be preserved, with its source/version context |

### Dictionary completeness by source

| Source | Records with dictionary / catalog | Entries | Nonempty descriptions | Explicit units |
|---|---:|---:|---:|---:|
| CMS | 41 / 159 | 6,555 | 1,454 | 0 |
| CDC | 1,126 / 1,472 | 25,866 | 14,283 | 0 |
| Census | 1,738 / 1,803 | 1,541,426 | 0 | 0 |

The aggregate is dominated by Census entries. Census labels and concepts are not definitions and were correctly kept separate in the packaged proposals. Zero explicit units is a missing classification problem as well as a missing data problem: a provider identifier should not receive an invented physical unit. Of the nonempty descriptions, 484 equal the field label exactly. All descriptor/page hashes checked by this run matched their manifest references.

## Findings and priorities

Priority 1 blocks dependable research use or gives misleading evidence. Priority 2 materially impedes use or maintenance. Priority 3 is polish or a limited operational issue.

| ID | Priority | Finding and impact | Evidence |
|---|---|---|---|
| F01 | 1 | Development, cached Git refs, release notes, and current production name different subjects. An implementer working from the active directory could repair an obsolete system. | Workspace identity; live corpus hashes |
| F02 | 1 | Every canonical access mechanism and retrieval interface is unknown; none has a machine-actionable recipe. The directory cannot yet answer “how do I get this data?” reliably. | Full record profile |
| F03 | 1 | Catalog-membership verification is the only general live verification. The original enumeration made 17 metadata requests and zero payload downloads. It did not test thousands of APIs. | Published corpus `build_boundary`; canonical evidence limitations |
| F04 | 1 | Every record lacks resolved geographic coverage, rendering the geography filter effectively a single unknown bucket. | Full profile; screenshots 12, 19 |
| F05 | 1 | 71% lack time bounds and 84% lack temporal granularity. Bounds that exist can describe vintages, projections, or incomplete current periods; they need separate semantics. | Full profile and date values |
| F06 | 1 | Detail guidance labels inferred unit tags as `source_asserted`. The HCRIS results card says observation grain is unresolved, but the use card presents Hospital/Facility/Provider/State as its typical unit with source-asserted evidence. | Screenshot 13; `apps/web/src/lib/researcherGuidance.ts:138` in release source |
| F07 | 1 | Freshness uses a frozen/default clock. All deadlines passed, yet a live response says “Review deadline has not passed.” | `catalog-first.body`; `retrieval-core-v1.2.mjs:533` |
| F08 | 1 | Inferred search categories are often broad and scientifically misleading even when labeled inferred. Maternal mortality expands into hospital/facility/provider concepts without establishing those as the data grain. | Query 15 and screenshot 15 |
| F09 | 1 | 529 records lack packaged dictionaries; CMS has particularly low coverage at 41/159. Per-record failure causes and next actions need an operational owner. | Hash-checked dictionary profile |
| F10 | 1 | Only 1% of dictionary entries have descriptions; no explicit units. A field list alone is insufficient for denominators, exclusions, weights, suppression, and code interpretation. | Dictionary profile |
| F11 | 1 | All 2,905 dictionaries remain proposals with unresolved schema applicability. Useful captured information sits outside canonical variables and machine recipes. | Retained descriptors; live dictionary responses |
| F12 | 1 | HCRIS documentation and a real API sample both contain 117 fields, but **11 field identifiers differ** by case, punctuation, or wording. Count-only validation would miss this. | [Field comparison](LOCAL-EVIDENCE.md#evidence-sample-shape-comparison-json) |
| F13 | 1 | Census returned HTTP 200 after redirecting to a Missing Key HTML page. Availability must check expected content and authorization outcome, not status alone. | `sample-census-acs` HTTP receipt and body |
| F14 | 1 | Zero documented joins means a user cannot establish safe CCN/NPI/FIPS linkage, cardinality, temporal alignment, or matching loss. | Empty published join file; machine join response |
| F15 | 1 | Important source families are absent or not usefully resolved. PHC4, HCUP, and NPPES return zero; MEPS returns a diabetes economic-burden record. | Queries 3–7 |
| F16 | 1 | Search confuses related but different research targets. Maternal mortality 2018–2023 leads with infant mortality 1915–2013. Hospital readmissions leads with a patient-safety indicator. | Queries 15, 20; screenshot 15 |
| F17 | 2 | Broad source ingestion brings unrelated material into default browsing and research results; the first browse item is a rat toxicology study of printer emissions. No task-based curated starting view exists. | Screenshot 02; query 8 |
| F18 | 2 | Family/release navigation is missing. The 579 repeated titles must be classified as releases, series, mirrors, views, or genuine duplicates, not deleted by title. | Full profile; machine empty release collections |
| F19 | 1 | All eight machine transports work, but working transport is not successful research functionality. HCRIS asset collections are empty/unknown; access and recipe are unknown; variables cannot resolve a schema; joins are empty. | Both actual MCP and WebMCP records |
| F20 | 2 | Nonretryable unknown-context errors tell the client to “Retry later without changing a valid generation pin.” This cannot recover missing release/schema information. | MCP error envelopes |
| F21 | 2 | Human responses use a manifest hash while machine tools use a `live-...` label; clients need explicit identity mapping. Sources also combines current v1.2.0 accounting with a v1.1.0 national-readiness table showing 157 records and 24 published Pennsylvania records. Its historical generation is labeled, but the current-looking coverage presentation needs reconciliation. | Human/machine identities; screenshot 06; `state-readiness.body` |
| F22 | 1 | No current-generation retrieval evaluation is published. The Methods page correctly says the old 143-record evaluation is historical; present-day relevance remains unqualified. | Screenshot 04 / Methods text |
| F23 | 2 | The home page has a clear search field and visual identity but no worked examples, beginner learning route, or visible proof of a complete research workflow. | Screenshot 01 |
| F24 | 2 | Internal labels dominate controls: `cms-data-catalog`, `public_catalog`, `canonical relevance`, and `use-case-metadata-discovery`. Unknown-only facets offer little help. | Screenshots 12, 19 |
| F25 | 2 | The 390px browse view requires scrolling through status/interpretation/receipt sections before reaching the first record. Ten cards make a roughly 9,042px page. | Screenshots 11, 18 |
| F26 | 2 | Dataset detail is dominated by repetitive caveats and unresolved boilerplate. The HCRIS “Best for” field says no use is documented despite useful publisher text and a real sample being available. | Screenshot 13 / full detail text |
| F27 | 2 | A page-receipt export exists, but the visible interface lacks a research shortlist, human comparison workflow, reusable study packet, and clear citation export. | Page controls and routes |
| F28 | 2 | About and Contact exist and name AJHCS and `info@ushso.org`. About leads with engineering terminology; funding/conflicts, editorial service levels, and introductory mission examples remain incomplete. | Screenshot 03; Contact/Methods text |
| F29 | 2 | The sitemap lists eight general pages, omits Methods and all dataset pages, and the initial HTML is a 653-byte SPA shell. Crawlers and agents without JavaScript receive little source content. | Sitemap/home captures |
| F30 | 2 | The 28 sequential live queries have median 232ms, maximum 4,411ms; eight exceed one second. This small, single-location sample is not a production percentile/SLO or isolated cold-start benchmark. | HTTP receipts |
| F31 | 3 | Cloudflare injects an Insights script that the site's CSP blocks, generating a console error on every inspected top-level page. Resolve the configuration deliberately. | Browser console record |
| F32 | 1 | Existing collectors/parsers/review packaging are reusable, but autonomous refresh and scientific promotion are not an operating end-to-end service. The Muse pilot shells through `dsh`, rather than a product-owned provider adapter with a spend ledger. | Release-source research scripts; scheduler/harvester disabled composition roots |
| F33 | 1 | MRF-related results are largely related catalog content or enforcement information. There is no tested hospital/payer MRF registry, schema-specific parser, bounded price preview, or release-aware comparison workflow. | Queries 9, 10, 27; catalog source inventory |

### The source tests establish feasibility, with limits

The CMS Hospital Provider Cost Report endpoint returned one JSON row with 117 columns. The CDC PLACES endpoint returned one JSON row with 154 columns, all matching that dictionary's field names. The HCRIS 11-name discrepancy demonstrates the need to preserve publisher labels and actual wire keys separately. This test does not establish full field types, release continuity, row uniqueness, complete geography, scientific fitness, or availability of every distribution.

The Census response demonstrates a real authentication/content-state case. It should become a typed `authentication_required` result with a documented next step. Do not fetch credentials merely to turn this audit result green.

The separate state-readiness artifact has 51 unique jurisdiction/FIPS rows and internally reconciled status counts: 34 navigation-only, four partial candidates, eight bounded gaps, three review-required, one prior transport failure, and one published v1.1.0 overlay. This is useful historical work to reconcile with current source intake. It does not supply geographic coverage for the current 3,434 records. The Sources page also distinguishes 1,472 enumerated CDC records from 1,468 searchable CDC records; that difference is explained by the four isolated records, not unexplained data loss.

## Research journeys and visual evidence

1. **Arrive and understand the mission — usable foundation, weak teaching.** Home renders clearly, with a labeled search field. Add three verified starting examples and distinct beginner/researcher/developer routes. [Home screenshot](LOCAL-EVIDENCE.md#evidence-01-home-png).
2. **Browse sources — mechanically usable, scientifically noisy.** Pagination works; stable count warnings are visible. Default ordering and repeated unknowns make the catalog hard to explore. [Browse screenshot](LOCAL-EVIDENCE.md#evidence-02-browse-png).
3. **Find an exact source — partly successful.** HCRIS resolves to its intended record, while PHC4 returns a bounded zero. This is coverage and named-source routing work, not a reason to invent a match. [HCRIS search](LOCAL-EVIDENCE.md#evidence-12-hcris-search-png)
4. **Assess scientific relevance — unreliable.** Maternal and infant mortality are not interchangeable; the requested interval is also not established. [Maternal mortality search](LOCAL-EVIDENCE.md#evidence-15-maternal-search-png)
5. **Inspect a source — understandable structure, incomplete substance.** The primary source description is useful; the decision card should emphasize verified scope and next steps, with evidence expandable. [HCRIS detail](LOCAL-EVIDENCE.md#evidence-13-hcris-detail-png)
6. **Inspect variables — working proposal viewer, incomplete contract.** HCRIS fields render and paginate, but proposal status, missing units, and wire-key discrepancies remain. [Dictionary inspection](LOCAL-EVIDENCE.md#evidence-14-hcris-dictionary-png)
7. **Navigate and return — targeted checks passed.** Page-two Back restoration, mobile filter Escape closure and focus return, and small-screen navigation worked. No horizontal overflow was measured in the tested states. [Journey checks](LOCAL-EVIDENCE.md#evidence-journeys-json).
8. **Use mobile — functional, too much content before results.** Compact status summaries and effective filters should place a real result within the initial search viewport. [Mobile browse](LOCAL-EVIDENCE.md#evidence-18-mobile-top-png)
9. **Learn methods and accountability — present, incomplete.** About, Methods, Contact, Privacy, Terms, and Agents pages render. Methods accurately disclaims current evaluation; practical tutorials and full disclosures are missing. [About screenshot](LOCAL-EVIDENCE.md#evidence-03-about-png).
10. **Use MCP/WebMCP — transport passed, data use blocked.** Eight tools were discovered/invoked on each tested surface, with the same broad complete/partial/unknown/empty outcomes. The research planner remains disabled. [Native results](LOCAL-EVIDENCE.md#evidence-webmcp-native-json).

These are targeted Chromium checks, not WCAG conformance, full assistive-technology testing, Safari/Firefox testing, marketplace installation verification, or an exhaustive link crawl. No source payload was sent to a model, no paid inference was invoked, and no production change was made.

## Engineering conclusion

The least expensive useful next step is to finish the evidence pipeline already started: enumerate exact distributions, extract structured metadata, execute tightly bounded public sample requests, validate content and field identities, resolve release links, then publish specific claims. A low-cost model is appropriate for residual document interpretation and drafting, with verifiable citations and abstention. It cannot verify an endpoint by reasoning about a URL, resolve a license through guesswork, or manufacture a valid join.

The [master plan](../../master-plan/2026-09-10/MASTER-PLAN.md) turns these findings into a dependency-checked program, PR-sized assignments, atomic commits, review evidence, and final product acceptance tests. Completion is defined by measured research usefulness, not counts of generated files, passing transport calls, or consensus between implementers.
