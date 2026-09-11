"""Canonical assignment source. Generated views are built by build.py."""
PRS=[]
def add(n, sub, title, deps, reqs, findings, files, outcome, commits, acceptance):
    assert len(commits)==3
    PRS.append(dict(id=f'PR-{n:03}',phase='P'+sub[0],subphase=sub,title=title,
      dependencies=[f'PR-{i:03}' for i in deps],requirements=reqs.split(),findings=findings.split(),files=files.split(),
      outcome=outcome,commits=[dict(id=f'C-{n:03}-{i+1}',subject=c.split('|')[0],instructions=c.split('|')[1],verification=c.split('|')[2]) for i,c in enumerate(commits)],acceptance=acceptance))

add(1,'1A','Reconcile the deployed release and integration base',[], 'R01 R16','F01',
 'docs/research-program/baseline.json docs/research-program/legacy-crosswalk.json',
 'One exact integration base and a preserved map of old work to this program.',[
 'Record the current release subject|Read the current remote main and release receipts without resetting the active dirty checkout. Select the base and prepare its isolated worktree before writing. Record commit, tree, Worker identity if available, corpus generation, dictionary manifest and observed endpoint identities in baseline.json.|Recompute corpus hashes and explicitly mark any unverified Worker identity; reject a mixture of unrelated candidates.',
 'Map existing work and constraints|Inventory reusable collectors, adapters, gates and unmerged branches. Map applicable old WP/SEMP/ADR IDs to program PR IDs with reuse, supersede or retain disposition and reason.|Every named existing production boundary has a destination or an explicit retained constraint; no generated SEMP view is hand-edited.',
 'Document the isolated integration workflow|Document the host worktree workflow and codex/ branch prefix on the selected base; preserve all current workspace edits. Add exact Node/lockfile and baseline-check instructions to the baseline receipt.|Clean integration worktree, unchanged original dirty files, and a reproducible baseline receipt; do not infer that cached origin/main is current.'
 ],['Base commit and deployed catalog relationship are explicit.','Existing release and scientific approval receipts remain unchanged.'])
add(2,'1A','Freeze research cohorts and acceptance denominators',[1],'R01 R04 R07 R09 R10 R12','F15 F22 F33',
 'evaluation/research-program/cohorts.json evaluation/research-program/tasks.json docs/research-program/acceptance.md',
 'A stable catalog denominator, 100-product core cohort, missing-source set and MRF pilot selection.',[
 'Define cohort identities|Write source-native product anchors for the 100-product cohort across the ten research domains in the master plan. Store product/release distinction, selection rationale and public/restricted expectation; seed all 3434 baseline record IDs separately.|No duplicate products counted through annual releases; every anchor resolves to retained source evidence or a named intake task.',
 'Freeze research tasks and negative cases|Create novice, advanced and machine tasks including HCRIS/PHC4, maternal versus infant mortality, ACS geography, nursing staffing, price definitions and forbidden joins. Mark holdout labels inaccessible to implementer tuning.|Hash cohort/tasks; every requirement R01–R16 has a measurable acceptance row with denominator and evidence owner.',
 'Pin MRF and expansion scope|Choose 25 hospitals across states/ownership types and ten payer reporting entities using authoritative directories. Include the twelve named missing families and map each to a bounded source intake.|Selection is documented before endpoint results are seen; unavailable items stay in the denominator and cannot be silently replaced.'
 ],['Cohort cannot improve by deleting difficult members.','Actual source IDs and locator evidence are included, not only a target count.'])
add(3,'1A','Make implementer handoffs and review evidence enforceable',[1,2],'R16','F01 F32',
 'docs/research-program/handoffs/ scripts/research-program/check-handoff.mjs tests/research-program/handoff.test.mjs package.json .github/pull_request_template.md tests/contract-package-inventory.test.mjs',
 'Every implementer PR arrives with enough evidence for independent review.',[
 'Add the task and receipt schemas|Translate EXECUTION.md into machine-checked task/handoff schemas: base/head, owned files, dependencies, changed behavior, commands/exits, fixtures, artifacts, hashes, risks and next consumer.|Fixtures reject a claimed pass without a command result, a missing artifact and a stale dependency SHA.',
 'Validate handoff packets|Implement check-handoff.mjs accepting one handoff JSON path, with path containment, file existence/hash checks and dependency matching. Add handoff.test.mjs. Keep private raw logs outside Git and link sanitized durable evidence.|Run on one valid and three incomplete packets; do not treat an implementer statement as independent verification.',
 'Wire PR guidance and test discovery|Add PR body fields and review states from EXECUTION.md. Document GitHub branch/PR commands and evidence links. Register test:research-program using node --test tests/research-program/*.test.mjs and include it in the root npm test chain; the existing tests/*.test.mjs glob does not discover this directory. Maintain the existing package-inventory assertion for the expanded npm test chain, preserving every legacy gate and exactly one navigator aggregate invocation.|An intern can submit a draft PR using a body file; the new handoff test is actually executed by npm test, with no automatic merge or deployment.',
 ],['Each open task has one owner and one branch.','Reviewer can replay a decisive check without reading a chat transcript.'])
add(4,'1B','Introduce field-level completeness and evidence states',[2],'R01 R02 R03 R06','F02 F04 F05 F09 F10',
 'packages/identity/schemas/ packages/normalization/ packages/coverage/ tests/research-program/field-states.test.mjs',
 'Completeness measures facts, applicability and test attempts separately.',[
 'Define field observation state|Add versioned value/evidence/applicability/attempt fields using existing contracts. Separate unsupported, missing, not-applicable, conflict, not-attempted and restricted; retain historical values on failure. Represent documented credential requirements, access costs and usage limits separately from observations, including unknown/conflicting values and evidence timestamps. Credential fields contain names or placeholders only; undocumented cost is unknown, never free by default.|Validate fixtures where unknown is not false, an identifier has no physical unit, and an expired observation retains its historical success. A documented key requirement and an unattempted payload check remain distinct; an unknown price or quota cannot become zero or unlimited.',
 'Project coverage from source facts|Build per-record/per-source counts for supported fields, attempted checks and essential readiness. Derive counts from the ledger rather than title tags or populated UI strings.|Reproduce the audit baseline and partition each denominator exactly; four isolated records remain accounted for.',
 'Publish a machine-readable completeness view|Expose the versioned coverage artifact to offline consumers with field reasons and last-attempt timestamps. Keep aggregate scores supplemental to the full vector. Expose a compact access-summary projection with credential, cost and usage-limit evidence plus the latest successful check and latest attempt, each scoped to its endpoint/resource and operation. Preserve endpoint-specific browser/CORS observations for developer recipes; never infer browser usability from server-side success.|Validate whole-catalog arithmetic and a record with mixed successful, restricted and failed checks. Metadata/document reachability cannot populate a successful payload-access badge; stale success remains historical and access-summary fields retain documented-versus-observed provenance.',
 ],['A fully rendered unknown card never counts as research-ready.','Every published percentage carries its cohort and generation.'])
add(5,'1B','Correct freshness and inferred-unit evidence labels',[4],'R02','F06 F07 F08',
 'packages/retrieval/tools/retrieval-core-v1.2.mjs worker/public-query-service.mjs apps/web/src/lib/researcherGuidance.ts tests/research-program/freshness-and-grain.test.mjs packages/search/static-search-backend.mjs apps/web/src/types/discovery.ts apps/web/src/types/catalog.ts apps/web/src/lib/catalogAdapter.ts apps/web/src/components/ResultCard.tsx apps/web/src/pages/DatasetDetailsPage.tsx tests/wp1-repository-abstraction.test.mjs apps/web/src/lib/researcherGuidance.test.tsx apps/web/src/lib/catalogAdapter.test.ts apps/web/src/components/ResultCard.test.ts apps/web/src/pages/DatasetDetailsPage.test.tsx',
 'The live clock and scientific evidence labels agree across cards, detail and APIs.',[
 'Use an explicit observation clock|Inject request evaluation time through the public service into freshness projection while preserving deterministic frozen-clock evaluation. Do not mutate immutable source observations.|A September 10 fixture with a September 5 deadline is overdue; before-deadline and invalid/missing dates remain distinct.',
 'Stop promoting inferred tags|Replace researcherGuidance typical-unit mapping from unit_of_analysis with the explicit observation-grain claim. Show inferred categories only as search aids.|The audited HCRIS fixture keeps grain unresolved until supported evidence exists; card/detail/machine evidence states match.',
 'Explain freshness scope in the UI|Render last successful metadata check, latest attempt and stale status together; distinguish catalog metadata from payload checks. Keep the current visual components.|Advance a clock fixture without rebuilding the corpus and verify UI/API status changes while evidence hashes remain stable.'
 ],['F06 and F07 reproduce before the change and fail to reproduce after it.','Frozen benchmark results are not accidentally made time-dependent.'])
add(6,'1B','Account for isolated records and unusable facets',[4,5],'R01 R02','F04 F17 F24',
 'packages/retrieval/tools/retrieval-core-v1.2.mjs packages/retrieval/tests/lexical-index.test.mjs tests/direct-base-regression.test.mjs tests/research-program/isolation-and-facets.test.mjs apps/web/src/data/facets.ts apps/web/src/data/facets.test.ts apps/web/src/pages/SearchResultsPage.tsx apps/web/src/pages/SearchResultsPage.test.tsx apps/web/src/pages/SourcesPage.tsx apps/web/src/pages/SourcesPage.test.tsx apps/web/src/components/FacetSidebar.tsx apps/web/src/components/FacetSidebar.test.tsx apps/web/src/types/catalog.ts apps/web/src/providers/discoveryProvider.ts apps/web/src/providers/discoveryProvider.test.ts',
 'Source defects are visible without making missing values useful filters.',[
 'Classify the four isolated CDC records|Reuse PR004 typed completeness/isolation accounting and retain the exact four frozen CDC identities, publisher identities, record hashes and sole missing-description validation failure. Add regression evidence for all 3434 baseline rows, 3430 searchable rows and four isolated rows, including partial_results. No source publication, description invention, current browser-schema relaxation or migration is in scope.|The 3434/3430/4 partition and four exact IDs/hashes reconcile against frozen PR002 and accepted PR004 artifacts. Source bytes and denominators remain unchanged; isolated rows remain typed and visible without being promoted into search.',
 'Make facet availability informative|Derive browser-only availability and concise reasons from the current facet options/counts and current total_matches. Unknown-only geography and uniform public_catalog access cannot pretend to narrow those current results or imply national coverage/payload access. Keep selected tokens removable when absent from the response. Offer count-free geography:unknown and access_status:unknown controls when omitted, preserving same-dimension OR and cross-dimension AND semantics. Make the fixture fallback apply the same canonical filter traversal, with truthful fixture-scope counts. Preserve the frozen API schema, response shape and actual count scope; no external availability/reason fields or invented disjunctive counts.|Unknown-only, uniform-access and mixed fixtures produce scoped explanations and correct counts. Known plus unknown filters round-trip even after options disappear from a narrowed response; selected filters can always be removed. Missing counts remain absent, never zero or stale broader counts. Live and fixture-fallback page interactions exercise actual filter behavior.',
 'Use public labels for facet values|Map source/capability values to captured readable labels and controlled enums to public labels while preserving canonical URL/API values. The live engine may change only existing facet label strings; use complete pre-pagination matches so a label need not depend on the current page. The shared web adapter derives the five canonical dimensions from canonical records and does not expose fallback aliases such as other-states or open-data-api as live filters. Preserve both frozen differential reference engines. In their current comparison tests, isolate only intentional label differences and assert the entire remaining response unchanged, with independent expected-label cases. Do not rewrite frozen fixtures, source artifacts or historical fingerprints.|Filter selections retain canonical values and identical record IDs/counts across pagination, live responses and fixture fallback. A facet value absent from the current page still has the correct captured label. Accessible names, checked state and described unavailability remain meaningful; controls without counts render no fabricated count. Differential tests preserve exact parity for every non-label field.'
 ],['No source row disappears during repair.','Unknown-only facets cannot pretend to narrow the catalog.'])
add(7,'1C','Bind products to releases and distributions',[4],'R02 R04 R05 R11','F11 F18 F19 F21',
 'packages/identity/src/ packages/identity/schemas/ packages/registry/ tests/research-program/release-binding.test.mjs packages/identity/manifests/package-manifest.json packages/identity/validation/validation-receipt.json',
 'Source-native identities can supply actual context IDs to clients.',[
 'Define release and distribution identity rules|Reuse the existing source/release/distribution contracts; add publisher identifiers, locator, release/revision date roles and hash-scoped identity when a publisher supplies no stable release ID.|Fixtures cover rolling endpoints, a replacement file, multiple distributions and conflicting dates without merging them.',
 'Resolve exact source relationships|Implement deterministic binding from captured catalog/resources records to releases and distributions. Preserve ambiguous and unresolved alternatives with evidence pointers.|One-to-many publisher distributions remain distinct; an ambiguous URL never produces a fabricated exact binding.',
 'Add generation identity mapping|Publish one explicit map between human manifest identity, machine generation and dictionary/source revision. Reject inconsistent cross-generation references.|Human-to-machine source lookup returns the same product context; stale or mismatched pins yield typed restart guidance.'
 ],['Every resolved ID has source evidence or a documented deterministic identity rule.','No existing stable ID changes meaning.'])
add(8,'1C','Separate wire fields from labels and scientific meaning',[7],'R02 R05','F10 F11 F12',
 'packages/identity/src/schema-catalog.mjs packages/identity/src/variable-identity.mjs packages/identity/src/index.mjs packages/identity/manifests/package-manifest.json packages/identity/validation/validation-receipt.json contracts/machine-toolkit/v1.2.0/schemas/variable-identity.schema.json scripts/research/source-extractors.mjs tests/research-program/variable-identity.test.mjs tests/research-extractors.test.mjs tests/dictionary-review.test.mjs tests/update-cycle.test.mjs tests/cms-layout.test.mjs',
 'Dictionary information can coexist with exact API keys without false schema claims.',[
 'Define variable identity and semantics|Add the strict additive contracts/machine-toolkit/v1.2.0/schemas/variable-identity.schema.json with wire_name, publisher_label, definition, publisher_concept, source_type, observed_type, unit/applicability, code values, missingness and exact source/asset/release/distribution/schema/field-revision context. Preserve frozen v1.0/v1.1 schemas and machine routes. Unresolved context carries nulls and a reason and cannot mint a resolved variable ID. Use context-scoped IDs without weakening existing immutable schema-catalog or join-endpoint contracts; update the current identity package seal through its existing tooling.|An identifier field accepts a reasoned not-applicable unit; a measurement missing units remains incomplete. Identical wire names in distinct release/distribution/schema contexts have distinct IDs. Invalid or foreign context cannot become resolved. The current identity package seal and frozen machine compatibility checks pass.',
 'Preserve literal dictionary extraction|Add a separately versioned extractor/adapter path for CDC/Census/CMS so literal labels, concepts and definitions occupy different fields. Preserve existing cdc_columns/census_variables transformations and their legacy projection byte-for-byte for historical proposal replay. Reuse the existing CMS layout parsers as read-only inputs; dictionary names without a verified wire mapping remain documented names. Record exact evidence pointers, capture/raw-value hashes and transformation versions. No legacy consumer, frozen response or CMS parser rewrite is authorized by this additive scope.|Census concept-only text leaves definition absent in the new model. Literal leading zeros, sentinel strings, Unicode, labels and escaped pointers survive round-trip. Legacy extraction, dictionary review, update-cycle and CMS layout tests remain passing; the old transformations retain their exact outputs.',
 'Represent name mappings explicitly|Add evidence-bearing documented-name to wire-name mappings with exact, reviewed alias, ambiguous or unmatched state. Do not normalize away semantic differences automatically.|The retained sample-shape-comparison.json audit records 117 payload and 117 dictionary fields with 11 identifier discrepancies; keep those supplied literal differences unresolved until additional payload/document context supports each match. The audit is a discrepancy summary, not a full 117-field inventory. Exact, reviewed-alias, ambiguous and unmatched cases retain evidence and alternatives; counts or punctuation normalization alone never approve a mapping.'
 ],['A 117-field count cannot conceal mismatched field identifiers.','Variable IDs are scoped by source release/distribution/schema.'])
add(9,'1C','Set evidence storage and verification operating bounds',[3,4,7,8],'R03 R14 R15 R16','F03 F13 F32 F33',
 'docs/adr/0008-operating-bounds-and-evidence-receipts.md docs/adr/README.md scripts/research-program/policy.json scripts/research-program/operating-bounds.mjs scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json scripts/research-program/receipts/v1.0.0/README.md tests/research-program/operating-bounds.test.mjs tests/research-program/fixtures/pr009-census-negative/',
 'Collection, sample retention and infrastructure decisions are explicit and cost bounded.',[
 'Reconcile the architecture decisions|Write a successor ADR for the cheapest measured control-plane/publication topology using existing PostgreSQL interfaces. Compare retained publication measurements and timestamped public prices with explicit workload, rights and recovery constraints; mark missing actual usage, bill and capacity facts as unresolved rather than inventing a cheapest result. Preserve the current static public runtime. Identify retained metadata storage versus a separately gated aggregate sample store; do not create paid resources or production bindings. A partial policy/receipt implementation does not by itself satisfy the measured topology decision.|List exact earlier ADR clauses superseded; no paid resource or production binding is created by a documentation decision.',
 'Define request and retention budgets|Define scripts/research-program/policy.json and a pure operating-bounds.mjs validator/composer using existing connector and ingestion exports as read-only dependencies. Specify descriptor/route IDs, per-source concurrency, timeout, redirect, raw/expanded-byte, row, retry and retention limits. Keep activation false; reject arbitrary user URLs and unauthorized operation classes. Ninety days is the active raw metadata/documentation default, with explicit evidenced shorter/longer source-policy overrides; retain existing dependency-aware GC and 365-day security/audit protections. Keep aggregate/sample rights and privacy decisions separate. No connector/ingestion code, live request, receipt persistence, DB, queue, workflow or deletion activation is owned here.|Policy fixtures reject missing/foreign route identities, arbitrary URLs, unbounded limits, unauthorized retention classes and activation. Use actual current descriptor, response-bound, retry and retention semantics without creating duplicate execution logic. Underlying strict ingestion records validate unchanged; no matching contract version may be assumed without schema validation.',
 'Implement the evidence receipt contract|Add a self-contained strict JSON Schema 2020-12 receipt at scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json plus its boundary README and registered operating-bounds.test.mjs. Compose request type/expected-content basis, safe final locator, scoped actual bytes/hash, source/parser identity, attempt outcome and next action without secrets or body content. Preserve all released ingestion contracts, connector/ingestion packages and WP5 v1.0.0 bytes. Consume the retained Census fixture as an unmatched historical negative observation: do not fabricate approved metadata route IDs, original expectations, connector execution or an unrecorded redirect count. Durable persistence remains PR010/011 scope.|Replay the committed retained Census 200-HTML body/hash as an access/content failure with unknown redirect count, not capture/payload/schema success. Test accepted capture, 304 reuse, access-only, pre-egress, typed failure and truncation separately. Truncated bytes never imply complete schema validation. Independently validate underlying strict records, identity/hash/size consistency and absent-secret/body boundaries; no transport or persistent side effect occurs.'
 ],['Infrastructure plan includes measured costs and unresolved external facts.','Current no-source-egress public request boundary remains enforced.'])

add(10,'2A','Connect durable collection jobs to existing ingestion ports',[9],'R03 R15','F32',
 'packages/ingestion/ services/scheduler-worker/ services/harvest-worker/ tests/research-program/job-lifecycle.test.mjs',
 'Bounded collection jobs resume safely and have durable outcomes.',[
 'Add a collection job specification|Reuse ingestion run/outbox/lease primitives and add source ID, exact configuration hash, selected record IDs, capture class and budget reservation. Keep scheduling separate from execution.|Duplicate schedule deliveries create one logical job; changing configuration produces a distinct job identity.',
 'Implement the collector port adapter|Connect existing research collector entry points through injected storage/network/clock ports. Checkpoint after bounded units and close database work between steps.|Interrupt after a successful capture and resume without duplicate source requests or losing the capture reference.',
 'Expose dry-run and local execution commands|Add a CLI that lists selected jobs and estimated limits before running. Emit terminal statuses and resumable checkpoint locations.|An intern can run a fixture job through selected, running, partial and complete states; production composition stays disabled.'
 ],['No process crash can convert an uncompleted job into successful coverage.','Each attempt has one durable outcome and exact configuration identity.'])
add(11,'2A','Validate HTTP content and source access outcomes',[9,10],'R03','F03 F13',
 'packages/connectors/src/ scripts/research/document-integrity.mjs tests/research-program/http-outcomes.test.mjs',
 'Normal source failures are correctly typed and do not contaminate metadata.',[
 'Define content-aware response classification|Add MIME, parse-shape, redirect destination and documented login/error-page checks to existing transport handling. Separate authentication-required, unavailable, content-mismatch and transient failures. Validate the final resource role against the requested documentation/API/data role after redirects; retain requested URL, redirect chain and final destination.|Use the captured Census Missing Key page with HTTP 200 and show that JSON success is impossible. Include the public-apis EPA developer link resolving to a Widgets page as a captured, dated destination/resource-role mismatch; reachability alone cannot yield an actionable API recipe.',
 'Enforce read and expansion bounds|Apply time/byte/row/redirect caps before passing bytes to parsers; stop and preserve the reason when a limit is reached. Reuse source policy validation.|Test a source ignoring requested limits, an interrupted response and compressed data exceeding the expanded-byte cap using local fixtures.',
 'Persist useful attempt evidence|Store sanitized headers, response hash, expected/actual content and specific next action. Preserve last good values when a check fails. Keep documentation reachability, endpoint payload validation and browser/CORS checks as separate attempt kinds.|A refresh failure changes attempt/staleness state without deleting the prior successful observation or publishing an error page as data. A reachable wrong-role redirect invalidates the actionable recipe while retaining the previous qualified observation and the failed attempt.',
 ],['200 alone never proves payload access.','Bounded failures retain actionable context without credentials or full private bodies.'])
add(12,'2A','Enforce source quotas, retries and resumable scheduling',[10,11],'R03 R15','F32',
 'packages/ingestion/ services/scheduler-worker/ tests/research-program/source-budget.test.mjs',
 'Thousands of checks respect publisher limits and survive retries.',[
 'Reserve source request budgets|Add per-host concurrency and daily request/byte reservations with UTC periods and a source-specific override table. Reuse the durable lease store.|Concurrent workers cannot both spend the last reservation; cancellation releases only unused reservations.',
 'Classify and schedule retries|Retry documented transient timeouts/429/5xx with bounded attempts and Retry-After. Route credential, parser and scientific ambiguity to specific queues without blind retries.|Fixture traces show the exact maximum request count and delay schedule for each outcome.',
 'Reconcile resumed source runs|Track completed, waiting, failed and skipped records with source-generation pins. Emit a denominator report after a restart or partial run.|Repeated completion/retry messages remain idempotent; a newer source capture cannot be overwritten by an older resumed job.'
 ],['Budget exhaustion produces an explicit incomplete run.','A full source outage cannot create an unbounded retry queue.'])
add(13,'2B','Extract CMS distribution and resource metadata',[7,8,11,12],'R03 R04 R05','F02 F09 F11',
 'scripts/research/cms-documents.mjs scripts/research/source-extractors.mjs packages/connectors/ tests/research-program/cms-resources.test.mjs',
 'All 159 baseline CMS entries expose evidence-backed distribution/resource candidates.',[
 'Bind CMS catalog resources exactly|Use captured dataset identifiers, resourcesAPI links and distribution objects; preserve title, temporal, modified and format fields in their proper roles.|A cost-report fixture distinguishes product-level coverage from the 2023 distribution and its later metadata modification.',
 'Extract dictionary and access candidates|Classify linked API, CSV, PDF/XLSX dictionary and landing-page resources with literal locator evidence. Reuse existing CMS resource collection.|Every selected locator traces to its catalog/resource pointer; duplicate links deduplicate by capture identity, not product identity.',
 'Produce the CMS cause ledger|Run the adapter across 159 IDs and report resource counts, missing locators, parser families, eligibility and next action.|All 159 have a reconciled row; a missing dictionary locator remains unresolved rather than dictionary-absent.'
 ],['Endpoint/distribution metadata is preserved without asserting payload success.','The CMS backlog is grouped by actionable parser/access cause.'])
add(14,'2B','Bind CDC view metadata and columns',[7,8,11,12],'R03 R05','F04 F09 F11',
 'scripts/research/source-extractors.mjs packages/connectors/ tests/research-program/cdc-view.test.mjs',
 'CDC view, column and documentation identities are consistently linked.',[
 'Resolve exact Socrata view metadata|Fetch the publisher view identified by its source-native ID; distinguish a tabular dataset from a document, visualization or external link.|Fixtures for each asset type keep non-tabular records out of the row-sample queue.',
 'Extract columns and metadata roles|Preserve wire fieldName, labels, types, descriptions, code values and custom-field evidence. Keep row label, date roles and geographic assertions separate.|PLACES produces its 154 documented fields without inferring geography completeness or a person-level grain.',
 'Build the CDC extraction receipt|Reconcile all baseline CDC IDs, dictionary eligibility and parser outcomes. Carry four currently isolated records into explicit compatibility/missing-data handling.|No source record disappears; dictionary counts are based on record IDs with parse receipts, not the number of fetched pages.'
 ],['View identity is verified before field extraction.','A visual/dashboard catalog entry is not misrepresented as a directly queryable table.'])
add(15,'2B','Support Census metadata and keyed sample requests',[7,8,11,12],'R03 R04 R05','F04 F10 F13',
 'scripts/research/source-extractors.mjs packages/connectors/ tests/research-program/census-api.test.mjs',
 'Census product/vintage/geography metadata and key requirements are explicit.',[
 'Resolve Census metadata links|Bind variables, geography, groups, examples and vintage links to exact catalog entries. Preserve aggregate versus microdata products and rolling series.|ACS five-year, ACS one-year and time-series fixtures remain distinct, with no false observation-period inference.',
 'Add a source-scoped credential adapter|Allow the collector to receive a Census key through the existing secret-provider port; never place it in evidence URLs, browser assets or model inputs. Missing keys produce a documented access step.|The audit’s keyless HTML response remains authentication-required; keyed fixture succeeds and all retained logs redact query credentials.',
 'Extract documented query dimensions|Parse geography hierarchy, allowed predicates and variable labels/concepts without treating them as definitions. Emit a bounded sample recipe only when required inputs are satisfied.|A Pennsylvania aggregate example uses its exact supported variables/geography and records the source’s required access conditions.'
 ],['No secret is needed to run offline tests.','A successful aggregate sample cannot establish a microdata access path.'])
add(16,'2C','Route difficult documentation to resumable parsers',[13,14,15],'R05 R06','F09 F10 F32',
 'scripts/research/cms-grid-parser.mjs scripts/research/collect-pdf-windows.mjs scripts/research/research-python.mjs tests/research-program/parser-routing.test.mjs',
 'Existing document parsers cover known document families with explicit residual queues.',[
 'Build a parser capability registry|Map captured document signatures/layout families to existing CSV, XLSX, text-PDF and grid parsers. Use exact version/hash inputs and known CMS cause-ledger fixtures.|A parser is selected by validated format/layout evidence; unsupported/scanned documents remain residual tasks.',
 'Connect bounded page-window resume|Reuse existing PDF window capture and parser checkpoints. Record page/table/row positions and parser-specific defects; cap OCR work separately if enabled.|Restart mid-document and show no lost or duplicate fields; changed source bytes invalidate incompatible checkpoints.',
 'Emit a document extraction coverage report|Reprocess retained CMS/CDC/Census documents without source traffic. Group failures by parser defect, missing source, encrypted/scanned content or ambiguous layout.|The report accounts for every eligible document and exposes unparsed table regions rather than calling partial parsing complete.'
 ],['The 95% target uses an evidenced publisher-accessible denominator.','Parser output retains page-level traceability.'])
add(17,'2C','Reconcile dictionary names with observed wire keys',[8,13,16],'R05','F12',
 'scripts/research/cms-variable-layout.mjs packages/identity/src/schema-catalog.mjs tests/research-program/wire-key-reconciliation.test.mjs',
 'Generated recipes use actual field names and reviewed aliases.',[
 'Retain the HCRIS mismatch fixture|Package the 117 source-document names and 117 observed API keys with hashes, including the eleven mismatches. Keep documentation labels distinct from wire identifiers.|Count equality passes but exact-key comparison fails on the old behavior; report all eleven differences.',
 'Implement evidence-scoped key reconciliation|Match exact names first; propose normalization candidates with their differences and context. Require unambiguous evidence/review for wording changes and reject collisions.|Fixtures with hyphen/case aliases, Adult/Adults wording and two ambiguous candidates cannot silently pick a wrong field.',
 'Feed accepted mappings into recipes|Use accepted wire names for query construction while retaining original labels, dictionary citations and mapping version.|An example request uses the observed API key, and a documentation update invalidates only the affected mapping for review.'
 ],['No broad punctuation stripping merges two source columns.','Every accepted nonexact mapping has a review/evidence record.'])
add(18,'2C','Extract definitions, code values and unit applicability',[8,14,15,16],'R05 R06','F10',
 'scripts/research/source-extractors.mjs packages/normalization/ tests/research-program/field-meaning.test.mjs',
 'Literal scientific documentation improves fields without invented semantics.',[
 'Extract codebooks as separate evidence|Parse documented code/value tables and missing/suppressed markers with pointers. Preserve code strings, leading zeros and publisher labels.|Numeric-looking identifiers remain strings; suppressed and missing values are not converted to zero.',
 'Represent units and definitions conservatively|Populate units only from literal documented statements or approved deterministic rules scoped to a field family. Separate label, concept, definition and not-applicable rationale.|Census concepts stay concepts; identifiers accept not-applicable, and a rate without its denominator remains incomplete.',
 'Report meaningful field coverage|Compute coverage by source, variable role and exact release, including descriptions equal to labels, unsupported units and conflicting codebooks.|Whole-package totals reconcile and high-volume Census fields cannot hide missing CMS/CDC semantics in the aggregate.'
 ],['No model is required for literal extraction.','A unit inferred only from a field name fails acceptance.'])
add(19,'2D','Build a bounded API and file example tester',[9,11,13,14,15,17],'R03 R04 R05','F02 F03 F12 F13',
 'packages/connectors/src/testing/ scripts/research-program/test-example.mjs tests/research-program/example-runner.test.mjs',
 'Each recipe can prove exactly what a small real request checked.',[
 'Define example-request receipts|Store source/release/distribution, sanitized parameters, expected content/fields, size and row limits, observation time and attempted checks. Support documented manual/keyed outcomes.|CMS/CDC audit samples and Census keyless response produce distinct expected outcomes.',
 'Execute and validate bounded samples|Run approved read-only sample recipes, compare actual fields/types to the contextual schema, and stop on content/limit mismatch. Do not treat sample success as full-file validation.|Wrong MIME, missing key, unexpected field, empty-but-valid data and ignored row limit have explicit results.',
 'Publish example previews safely|Generate a small approved aggregate preview or explicitly synthetic schema example, with capture date and scope. Preserve source pointers even when sample values cannot be retained. Generate copyable cURL and Python examples from the same tested recipe, retaining credential placeholders, exact wire fields, request limits and source/release/distribution identities. Explicitly mark untested or credential-blocked examples.|A user can distinguish actual sampled values from synthetic examples; no restricted/private value enters a public artifact. Generated examples round-trip to the bounded recipe and cannot silently drop its limits, context pins or credential placeholders.',
 ],['An HTTP success code alone never produces a tested-example badge.','Sample field/type checks and full dataset/schema checks remain separate.'])
add(20,'2D','Schedule a complete baseline eligibility and attempt sweep',[12,13,14,15,16,19],'R01 R03 R06','F03 F09 F32',
 'scripts/research-program/sweep.mjs packages/coverage/ tests/research-program/sweep-accounting.test.mjs',
 'Every baseline record receives a bounded processing disposition.',[
 'Compile the full inventory into jobs|Join all 3434 IDs to source adapters, documentation and sample eligibility. Record why an operation is not applicable or blocked and reserve budgets before dispatch.|Inventory count equals the sum of disjoint dispositions; unknown eligibility is visible and not counted as attempted.',
 'Run resumable source batches|Execute selected bounded jobs through the shared runner, saving partial outcomes. Reuse unchanged captures and route format/access exceptions to named queues.|A stopped/restarted batch has identical final membership to an uninterrupted fixture; no duplicate capture charges.',
 'Write source and field deficit manifests|Emit the remaining missing facts and exact next action per record, with counts by cause and priority-cohort impact.|All original audit gaps have an observed disposition; completion cannot be asserted while unattempted eligible records remain.'
 ],['All baseline IDs are present in the sweep receipt.','Live source access respects selected budgets and current source policies.'])
add(21,'2D','Close deterministic extraction deficits and publish the baseline',[18,20],'R01 R03 R04 R06','F02 F09 F10 F32',
 'packages/coverage/ scripts/research-program/qualify-deterministic.mjs docs/research-program/deterministic-results.md',
 'Deterministic results have a measured acceptance boundary and an explicit residual workload.',[
 'Reconcile successful and failed evidence|Validate references, source-context bindings, parser coverage and timestamps over the full sweep. Preserve partial dictionaries and stale observations with their reasons.|Every successful result has a matching capture/parser receipt; missing evidence prevents promotion.',
 'Create residual tasks from actual gaps|Generate bounded residual jobs by source/document/field, excluding facts that require credentials, missing evidence or forbidden access. Route parser defects back to engineering.|No LLM task asks a model to discover a missing fact from memory; every task includes an exact public passage or an explicit insufficient-evidence outcome.',
 'Publish a deterministic completion readout|Report attempt coverage, parsed dictionary yield, working examples, unresolved essential fields and source differences. Add bounded follow-up PRs when an empirical target fails.|R03/R06 denominators are reproducible; a failed threshold stays failed and does not become an undocumented exception.'
 ],['The next phase receives a concrete residual queue, not the entire corpus by default.','The last good public generation remains unchanged until publication validation.'])

add(22,'3A','Add a product-owned OpenRouter extraction adapter',[9,21],'R14','F32',
 'packages/enrichment/openrouter-client.mjs packages/enrichment/provider-schema.json tests/research-program/openrouter-client.test.mjs',
 'Residual extraction can call an exact provider/model through a small typed interface.',[
 'Define the provider request contract|Add model/endpoint identity, prompt hash, evidence IDs, JSON response schema, token limits and timeout. Keep provider credentials behind an injected secret port.|Offline fixtures cover missing credentials, unsupported structured outputs and a missing exact model; none falls back silently.',
 'Implement the bounded OpenRouter client|Use the official API through an injected transport; require supported parameters and validate the returned JSON locally. Retain response/model/usage identifiers and typed errors.|Malformed JSON, truncated output, provider error and schema-valid but unsupported fields are rejected without publishing claims.',
 'Replace the extraction shell dependency|Connect the residual-job port to the adapter instead of launching dsh for product enrichment. Keep external coding implementers separate from this runtime.|A fake-provider end-to-end job passes without a harness installation; no model is imported into the public Worker request path.'
 ],['Actual paid calls remain disabled until the selected budget/key are provisioned.','Provider transport success is not claim acceptance.'])
add(23,'3A','Control provider data policy and evaluated fallbacks',[22],'R14','F32',
 'packages/enrichment/provider-policy.mjs packages/enrichment/model-snapshot.json tests/research-program/provider-policy.test.mjs',
 'Only approved public evidence reaches an explicitly selected model endpoint.',[
 'Snapshot model and endpoint capabilities|Read the public catalog and provider endpoint metadata at configuration time. Store exact model IDs, prices/overrides, supported parameters and data-use policy version.|A changed or unavailable model enters review; a latest alias cannot replace the evaluated model unnoticed.',
 'Enforce evidence eligibility|Accept approved public documentation captures only. Reject secrets, private queries, restricted content and unapproved contributor transmission using the collection classification.|Fixtures ensure excluded material never reaches the fake network transport; logging does not reintroduce it.',
 'Implement a bounded fallback policy|Allow only evaluated models/providers with equal-or-stricter data policy and an accepted maximum price. Record the actual selection for each attempt.|A privacy-incompatible fallback is refused even when cheaper; an unevaluated free router does not become the default.'
 ],['Muse Contributor data-use terms are explicit in the operator configuration.','No source URL, endpoint or provider is selected from untrusted document instructions.'])
add(24,'3A','Enforce inference budgets, deduplication and usage accounting',[12,22,23],'R14 R15','F32',
 'packages/enrichment/budget-ledger.mjs packages/enrichment/job-cache.mjs tests/research-program/inference-budget.test.mjs',
 'Concurrent enrichment jobs cannot silently exceed the selected spend cap.',[
 'Reserve worst-case request spend|Compute reservations from input tokens, maximum output/reasoning allowance, selected maximum prices and retry policy. Use atomic durable reservations and a configurable UTC period.|Two workers racing for the final budget unit cannot both proceed; missing price data fails closed.',
 'Reconcile actual provider usage|Persist usage/cost/provider IDs on success and uncertain-charge state on interrupted responses. Cap retries and honor Retry-After without repeatedly purchasing the same task.|Tests cover timeout after send, 402, 429, malformed usage and process restart; uncertain charges are not assumed free.',
 'Cache by complete task identity|Key cached proposals by source bytes, parser/prompt/schema/model/provider-policy versions and task scope. Emit cost per accepted claim and review workload.|A changed source or prompt invalidates the cache; an unchanged rerun performs no duplicate inference.'
 ],['The proposed $10 pilot/$50 monthly values are editable configuration, not hidden defaults.','The cost report includes failures, retries and rejected proposals.'])
add(25,'3B','Build bounded residual evidence tasks',[18,21,24],'R05 R14','F09 F10 F11',
 'packages/enrichment/task-builder.mjs packages/enrichment/task.schema.json tests/research-program/residual-task.test.mjs',
 'Models receive only the specific evidence needed for a named unresolved field.',[
 'Classify residual task types|Separate prose definition, table extraction, scientific ambiguity, missing evidence and access blockade. Only the first two are routine model extraction; scientific ambiguity is an adjudication proposal.|A missing publisher document is not converted into a request to guess the contents.',
 'Chunk with evidence boundaries|Build token-bounded passages preserving table headers, page positions, field context and overlap identity. Attach exact source/release and expected output scope.|A multi-page table does not lose its denominator/header; overlapping chunks cannot double-count a field.',
 'Emit task manifests and abstention paths|Record required evidence coverage, token estimate and what cannot be concluded. Send oversized or low-information cases back to parsing/collection.|Every accepted task has source bytes and a stable ID; incomplete context allows abstention rather than forced completion.'
 ],['No task processes the entire corpus by default.','Models are never asked to authorize access or establish endpoint availability.'])
add(26,'3B','Validate evidence-cited model extraction',[25],'R02 R05 R14','F10 F11',
 'packages/enrichment/extract.mjs packages/enrichment/validate-claims.mjs tests/research-program/claim-validation.test.mjs',
 'Model output becomes a traceable proposal with explicit uncertainty.',[
 'Define constrained extraction outputs|Require field path, proposed value, source passage IDs, exact quotation/span, claim type, uncertainty and abstention reason. Keep output limited to the requested task scope.|A model cannot introduce an unknown field, citation or record ID even when its JSON is syntactically valid.',
 'Check source support deterministically|Verify quoted spans/pointers against immutable captures, enforce field/context binding and reject invented units/definitions. Preserve raw response separately from normalized proposals.|Correct quote with wrong semantic role is flagged for review; quote matching alone never certifies scientific correctness.',
 'Record acceptance and rejection evidence|Persist proposal hash, model identity, validators, rejected fields and reasons. Make retry decisions specific to syntax/transport failures rather than repeatedly asking until a preferred answer appears.|Unsupported claims remain rejected across reruns; accepted literals can be traced back without calling the model again.'
 ],['100% of accepted proposals have resolvable citations.','A schema-valid hallucination fails claim validation.'])
add(27,'3B','Evaluate DeepSeek and Muse on held-out extraction tasks',[2,24,26],'R14','F10 F32',
 'evaluation/enrichment/ scripts/research-program/evaluate-enrichment.mjs docs/research-program/model-selection.md',
 'Model choice is based on correct accepted claims and review cost.',[
 'Create independently adjudicated tasks|Use representative CMS tables, CDC definitions, Census labels, units, date roles and deliberately insufficient evidence. Keep held-out labels outside implementer prompts.|Labels include critical-error categories and reviewer disagreement; model output is not its own gold standard.',
 'Run paired bounded evaluation|Compare the two exact model IDs with the same captured passages and output schema under a selected pilot budget. Save tokens, actual price, latency, abstentions and rejected claims.|Offline harness works without credentials; any live test reports exact model/endpoint and total spend.',
 'Select the initial task-specific policy|Report claim precision, useful coverage, critical errors and cost including review effort. Require ≥0.98 held-out precision and zero critical errors before routine publication eligibility.|A model failing a task class is disabled for that class; neither cheap tokens nor inter-model agreement overrides the gate.'
 ],['Evaluation is reproducible from retained inputs/outputs.','A failed model gate leaves deterministic collection operational.'])
add(28,'3C','Create a review queue for exact claims and conflicts',[26,27],'R02 R05 R14','F10 F11 F32',
 'packages/identity/src/review-queue.mjs packages/enrichment/review-packet.mjs docs/research-program/review-rules.md',
 'Reviewers see a proposed value, its source and its precise downstream effect.',[
 'Build compact claim review packets|Show before/after values, exact release/context, cited passage, parser/model version, disagreements and affected products/examples. Group identical evidence without merging separate source identities.|A reviewer can accept one field while leaving others unresolved; packet hashes bind the precise values reviewed.',
 'Add recorded dispositions|Support accept, reject, request evidence and supersede with reviewer identity and rationale. Give scientific units, denominators, grain and identity conflicts higher review priority.|Revised source bytes or changed proposals invalidate stale decisions instead of inheriting approval.',
 'Expose queue and turnaround metrics|Report queue age, cause, priority-cohort blockers and accepted/rejected counts. Route factual owner disclosures separately from source-document interpretation.|Every pending essential field has an owner/next step; the report never describes pending proposals as public facts.'
 ],['Astra can independently replay evidence validation from each packet.','A reviewer is never asked to approve an unspecified whole dataset.'])
add(29,'3C','Promote qualified metadata under explicit rules',[4,7,8,28],'R01 R02 R05 R14','F11 F32',
 'packages/normalization/ packages/identity/src/review-ledger.mjs scripts/research/claim-selector.mjs tests/research-program/promotion.test.mjs',
 'Supported literal metadata can scale while high-impact uncertainty remains reviewable.',[
 'Define promotion classes|Allow validated literal publisher metadata under an approved field/source rule; require explicit review for high-impact scientific interpretations, identity merges and ambiguous mappings. Record the policy version.|Not every literal field needs a separate human click, but no inferred scientific statement receives literal-observation status.',
 'Apply exact accepted claim revisions|Build a candidate revision using source/generation/value hashes and individual dispositions. Keep rejected/conflicting/unknown values and their provenance intact.|A stale approval, incomplete source run or changed field hash cannot promote; unaffected accepted claims remain available.',
 'Produce reversible promotion diffs|Output before/after source-card/schema/example changes plus dependent search/API effects. Support returning to the previous accepted generation without destructive data migration.|Rollback restores prior public facts and retains the newer attempt/review history for diagnosis.'
 ],['Scientific and technical acceptance are separate recorded decisions.','Automated rules cannot authorize source access or legal rights.'])
add(30,'3C','Publish coherent metadata generations',[7,21,29],'R01 R02 R11 R15','F11 F19 F21 F32',
 'packages/registry/ packages/search/publication-lifecycle-v2.mjs scripts/stage-research-assets.mjs apps/web/src/pages/SourcesPage.tsx tests/research-program/publication-parity.test.mjs',
 'UI, search, dictionaries and machine tools consume the same accepted generation.',[
 'Assemble the accepted publication manifest|Include canonical revisions, dictionary bindings, examples, source cards, coverage, search projection and contract versions. Reconcile the Sources page v1.1.0 national-readiness table with the current generation: migrate supported facts or explicitly archive that historical view. Reuse immutable publication/checksum machinery.|Manifest closure rejects missing assets, source-context mismatches and undeclared partial fragments; a historical Pennsylvania published-record count cannot appear as current coverage.',
 'Integrate bounded content delivery|Serve only needed record/dictionary/example pages through existing repository ports. Measure asset-count and response-size consequences before selecting a storage transition.|A large dictionary is paged predictably; one bad asset does not blank the entire catalog.',
 'Verify generation promotion and rollback|Compare every public projection against the accepted source revision and publish only after closure checks. Exercise N−1 retrieval and typed expired-generation behavior.|No request mixes old catalog records with a new dictionary; failed publication leaves the last good version live.'
 ],['Actual source evidence is available through both human and machine projections.','Current static fallback remains a tested recovery option.'])

add(31,'4A','Model observation grain and temporal applicability',[7,8,29],'R02 R04 R05','F05 F06 F08',
 'packages/identity/src/researcher-guidance.mjs packages/normalization/ tests/research-program/grain-and-time.test.mjs',
 'A source card distinguishes what one row represents from release and reporting dates.',[
 'Define distinct research dimensions|Represent observation grain, sampled entity, reporting organization, universe and geographic dimension separately. Use explicit unknown states for undocumented dimensions.|HCRIS facility/report/year and PLACES county/measure/year fixtures cannot collapse into a generic hospital/person tag.',
 'Bind date roles to evidence|Map collection period, fiscal/calendar year, release, revision and projection horizon from captured statements. Preserve overlapping ACS periods and rolling releases.|A metadata-modified date cannot fill observation end; a projection to 2100 is not observed future data.',
 'Add context-specific scientific checks|Check essential date/grain consistency for priority examples and route conflicts for review. Show source-native terms alongside normalized fields.|Incompatible reporting periods yield a specific caution/blocker; no automatic fiscal-to-calendar equivalence.'
 ],['Every normalized dimension has source/review evidence.','The UI no longer substitutes inferred tags for grain.'])
add(32,'4A','Represent measures, denominators and uncertainty',[18,29,31],'R04 R05','F10 F16',
 'packages/identity/schemas/researcher-use-card.schema.json packages/normalization/ tests/research-program/measure-semantics.test.mjs',
 'Researchers can distinguish comparable measurements from superficially similar fields.',[
 'Add measure semantics|Represent numerator, denominator/universe, scale/unit, adjustment, weight, confidence interval/MOE, suppression and missingness as separately evidenced fields.|A rate, count, percentage and monetary total cannot share a unit merely because their labels look similar.',
 'Populate representative scientific fixtures|Use captured publisher definitions for HCRIS financial measures, CDC prevalence/mortality and ACS estimates/MOE. Label missing definitions and unsupported conversions.|Maternal versus infant mortality, crude versus adjusted rates and overlapping ACS estimates are explicit non-equivalences.',
 'Validate scientific example inputs|Require the essential semantics for each recipe’s field set. Preserve optional unknowns but block a research-ready badge when its denominator or unit is essential and missing.|A source with an executable API but an unknown measurement denominator fails the relevant research task.'
 ],['No cross-drug, cross-year or cross-population conversion is inferred without evidence.','Scientific cautions are specific to the selected measure.'])
add(33,'4A','Generate useful source cards from accepted facts',[30,31,32],'R04 R05 R13','F26',
 'packages/identity/src/researcher-guidance.mjs apps/web/src/lib/researcherGuidance.ts tests/research-program/source-card.test.mjs',
 'Source pages answer practical research questions with concise, supported facts.',[
 'Define a source-card view|Require plain-language purpose, coverage, grain, example variables, access steps, tested state, limits and citation. Separate documented use, reviewed recommendation and unsupported use.|A card cannot declare Best for from topic tags alone; missing essential facts produce an explicit incomplete status.',
 'Generate cards for representative domains|Create evidence-bound cards for finance, staffing/quality, public health and survey/population products using accepted canonical fields. Reuse text rather than copying generic warning paragraphs.|Each sentence that makes a source claim resolves to evidence; a reviewer can compare the rendered card with the publisher passage.',
 'Connect cards to examples and guides|Attach exact release/schema/example IDs and the relevant beginner/expert guide. Keep detailed provenance expandable.|A reader can move from purpose to variables to a tested access step without searching through repeated caveats.'
 ],['Working HCRIS/PLACES examples have supported useful descriptions.','Cards retain material limitations without presenting every unknown as a full page section.'])
add(34,'4B','Preserve identifier systems and key constraints',[7,8,31],'R08','F14 F18',
 'packages/identity/src/exact-identifier-policy.mjs packages/identity/src/schema-catalog.mjs tests/research-program/identifier-systems.test.mjs',
 'Keys are typed by identifier system, entity and validity period.',[
 'Define identifier-system metadata|Represent CCN, NPI, FIPS/GEOID, source report IDs, tax identifiers and plan identifiers with source-specific formatting and entity role. Preserve leading zeros.|CCN and NPI are never interchangeable; equal strings from different systems do not establish identity.',
 'Attach key roles to exact fields|Record candidate key, composite key, foreign key or display label only with documentation or scoped sample evidence. Separate observed uniqueness from full-release uniqueness.|A sample unique identifier is not certified globally; composite facility/report/year keys remain composite.',
 'Validate identity and historical scope|Add retired/reused IDs, changed geography vintage and multiple identifiers per organization to fixtures. Keep human-reviewed resolution decisions versioned.|An identifier match outside its applicability period becomes ambiguous or incompatible, not exact.'
 ],['No automatic name-based merge is added.','All key checks report their sampled/full-release evidence scope.'])
add(35,'4B','Ingest authoritative crosswalks and mapping evidence',[12,19,34],'R08','F14',
 'packages/identity/src/family-graph.mjs packages/identity/src/join-routes.mjs scripts/research-program/crosswalks.mjs',
 'Cross-source linkage candidates have authoritative mapping and version context.',[
 'Register priority crosswalk sources|Select documented CCN/NPI/facility and geographic-vintage crosswalks for the frozen tasks. Store publisher, release, rights and exact download/access route.|Each route’s intended entity and key system matches the research task; absence of a crosswalk is explicit.',
 'Parse bounded mapping evidence|Use shared collectors/parsers and preserve one-to-many mappings, unmatched keys and date scope. Keep source-native IDs without heuristic identity merging.|A many-to-many or ambiguous mapping cannot collapse to one preferred row silently.',
 'Create evidence-bearing route candidates|Attach mapping transforms, cardinality expectation, universe, time constraints and required review to each route.|A candidate route remains candidate until its scoped validation and review are complete.'
 ],['Mapping files are treated as data products with their own versions.','A shared field name alone cannot produce a route.'])
add(36,'4B','Validate and publish priority join routes',[32,35],'R08 R11','F14',
 'packages/identity/src/join-routes.mjs evaluation/research-program/joins/ tests/research-program/join-evidence.test.mjs',
 'At least fifteen intended joins have inspectable compatibility evidence.',[
 'Build join validation fixtures|For each selected route, record input counts, eligible key counts, uniqueness, nulls, mapping multiplicity and expected outputs. Include one valid and one incompatible temporal/universe case.|Fixtures detect row multiplication, leading-zero loss and unmatched rows rather than just successful SQL execution.',
 'Compute scoped linkage metrics|Report matched/unmatched denominators, join expansion and exclusion reasons. Separate sampled checks from full-release checks and preserve evidence hashes.|No route reports a universal match rate from a tiny sample; incompatible contexts remain blocked.',
 'Publish qualified routes and caveats|Promote reviewed route metadata through the same generation and expose direct/two-hop paths only where supported. Recheck all fifteen priority routes.|Machine/UI consumers receive identical compatibility and limits; HCRIS-to-NPPES cannot claim CCN=NPI.'
 ],['R08 remains incomplete if fewer than fifteen routes are qualified.','Typed negative cases are as important as successful route output.'])
add(37,'4C','Resolve named sources and release families',[7,30],'R04 R07 R09','F15 F17 F18',
 'packages/retrieval/fixtures/named-source-registry.v1.0.0.json packages/identity/src/family-graph.mjs packages/retrieval/tools/question-parser.mjs',
 'Exact named-source requests distinguish the product family from related catalog text.',[
 'Expand the source-name registry|Add reviewed names/acronyms and exact product anchors for the core cohort and twelve expansion families. Record not-yet-indexed identities without inventing catalog membership.|MEPS/HCUP/NPPES/PHC4 exact-name fixtures cannot resolve to unrelated descriptions mentioning similar words.',
 'Group evidenced releases and views|Build family relations from source-native links and documented series, with ambiguous title matches remaining candidates.|The 579 repeated-title cases are accounted for; title equality alone never deletes or merges a record.',
 'Return exact versus contextual results|Give named-source matches their own result state and offer source-intake/authoritative route information when absent. Keep broader context separately labeled.|An unavailable named source returns a specific bounded coverage explanation, not a fabricated exact match.'
 ],['Named-source resolution is evidence-backed and independently testable.','Catalog membership and source-family recognition remain distinct.'])
add(38,'4C','Correct research relevance and exclusion behavior',[31,32,37],'R07','F08 F16 F17',
 'packages/retrieval/tools/question-parser.mjs packages/retrieval/tools/retrieval-core-v1.2.mjs packages/retrieval/fixtures/controlled-vocabulary.json',
 'Search respects important scientific distinctions and explicit user constraints.',[
 'Add scientific near-miss fixtures|Use maternal/infant mortality, readmissions/PSI, provider relief/quality, insurer rate/enforcement and requested observation-period counterexamples from the audit.|Fixtures identify which matches are forbidden, uncertain or merely contextual; no test expects a title-only answer.',
 'Refine deterministic intent and ranking|Apply exact phrase, named-source, exclusion and supported dimension logic before broad source priors. Separate missing context from confirmed compatibility.|An explicit without Census filter excludes Census; maternal mortality does not promote infant data as the leading compatible result.',
 'Preserve explanations and bounded zero results|Return concise reasons for exact, uncertain, contextual and excluded candidates using the same ranking logic. Keep known missing-source guidance.|The nonsense-plus-Pennsylvania query remains a scoped zero; ranking reasons agree with actual filters and evidence.'
 ],['No tuning uses the held-out labels.','Improved relevance is measured across domains, not only the original 28 questions.'])
add(39,'4C','Publish a current-generation retrieval evaluation',[2,30,36,38],'R07 R16','F22',
 'evaluation/research-program/ scripts/research-program/evaluate-retrieval.mjs docs/EVALUATION.md',
 'The current product has a reproducible relevance and coverage report.',[
 'Bind evaluator and result identities|Pin corpus, canonical revisions, ranking code, vocabulary, question split and reviewer labels. Retain the historical 143-record baseline separately.|Comparisons reject mismatched cohorts or generations rather than reporting misleading improvements.',
 'Compute research-level metrics|Report present-source recall@10, precision@5, full-universe recall, forbidden results, named-source misses, uncertainty and per-domain outcomes with denominators.|Known absent sources reduce full-universe coverage; they do not silently vanish from the evaluation.',
 'Publish results and failures|Write machine-readable results plus a readable Methods report. Keep raw rankings and adjudication notes for Astra review.|Require R07 targets and zero critical forbidden matches; a failing domain has a bounded remediation task instead of a passing summary.'
 ],['A current Methods page can link directly to this exact result.','Producer tests and independent reviewer labels are reported separately.'])
add(40,'4D','Track core-cohort research readiness by product',[2,21,30,33],'R04 R05','F02 F09 F11 F26',
 'packages/coverage/ scripts/research-program/core-readiness.mjs evaluation/research-program/cohorts.json',
 'Every priority product has a measured route from source evidence to use.',[
 'Join the cohort to exact contexts|Resolve each product anchor to its selected releases, distributions, documentation, examples and scientific claims. Preserve manual/restricted branches.|Annual releases do not inflate the 100-product denominator; missing essential context remains a named blocker.',
 'Compute essential readiness|Evaluate mandatory source-card fields, recent sample/route success, example field semantics and evidence closure. Keep public sample and restricted route completion separate.|A thousand populated optional fields cannot compensate for an unknown essential denominator or inaccessible recipe.',
 'Generate bounded deficit assignments|For each remaining blocker, emit source/document/field scope and required evidence into the exception PR template; group only related parser/adapter causes.|Every incomplete priority product has a concrete next task; the program gate cannot waive it by adding more easy records.'
 ],['At least eighty core products must have working public samples.','Remaining cohort products need verified manual/restricted routes with documented contents.'])
add(41,'4D','Build reproducible research example packets',[33,36,40],'R04 R05 R08 R13','F26 F27',
 'evaluation/research-program/examples/ scripts/research-program/build-example-packet.mjs',
 'Users can reproduce a source selection and its technical next steps.',[
 'Define the research example packet|Include question, selected products/releases, why each is needed, fields, access steps, tested request, supported join routes, caveats and citations.|A packet is invalid if its source/schema generation differs from an attached request or result.',
 'Author representative worked examples|Prepare finance/utilization, staffing/quality, insurance/geography and public-health examples from accepted facts; explicitly state unavailable restricted steps.|Every executed step has a receipt, while a documented but unexecuted step is visibly labeled.',
 'Validate examples end to end|Replay eligible bounded requests through the common tester and reconcile their fields and source context. Record expected output shape, not fragile current numeric constants.|A changed source schema invalidates the example and preserves its previous dated version; no live data is fabricated for a demo.'
 ],['A novice can follow an example without supplying unstated prerequisites.','An expert can inspect exact source IDs, fields and evidence.'])
add(42,'4D','Qualify scientific completeness of the priority cohort',[32,39,40,41,43,44,45,54],'R04 R05 R07 R08','F05 F10 F14 F16 F22',
 'evaluation/research-program/review/ scripts/research-program/qualify-core.mjs docs/research-program/core-acceptance.md',
 'Core research usefulness is independently assessed, with deficits blocking acceptance.',[
 'Assemble a reviewable core matrix|Produce one row per product with essential-field outcomes and links to examples/citations, plus per-domain totals. Expose every unsupported claim and conflict.|All 100 products reconcile to their source contexts and acceptance requirements; no unknown cell counts as supported.',
 'Review high-impact semantics|Have Astra independently check unit/grain/date/denominator/join evidence and route unresolved domain judgments to a named human research reviewer. Record exact accepted values.|An implementer or model cannot approve its own scientific output; failed cases remain visible and receive bounded follow-up PRs.',
 'Issue the core qualification receipt|Run the complete core checks on the accepted generation and record readiness, reviewer scope and remaining limits.|Only issue a pass when R04/R05/R07/R08 actually hold; otherwise retain the failed matrix and continue remediation.'
 ],['This PR automates and records qualification; the review does not substitute for missing evidence.','Current core readiness is published with exact scope and date.'])

add(43,'5A','Add missing federal source-family routes',[13,14,15,30,37],'R09','F15',
 'packages/connectors/source-registry/ packages/retrieval/fixtures/named-source-registry.v1.0.0.json evaluation/research-program/source-intake/',
 'HRSA AHRF, NPPES, SAMHSA, T-MSIS/TAF and SVI have supported product identities and access routes.',[
 'Capture exact publisher intake records|Use the five frozen source-family anchors; verify product title, operator, authoritative documentation, formats and current access terms. Reconcile existing representations first.|Every locator is publisher-supported; TAF restricted research files are not confused with public summary products.',
 'Configure existing adapters per source|Use the common API/DCAT/file/document ports where applicable and typed manual routes elsewhere. Bind product/release metadata and a small public example only when supported.|Each family has a literal configuration and fixture; an unsupported protocol produces a specific extension task rather than a custom unbounded scraper.',
 'Publish and evaluate the new routes|Add accepted source-family metadata, source cards and named-source tests through normal publication. Retain unresolved coverage/rights fields.|The original NPPES/AHRF/SAMHSA/SVI questions identify the intended family, and exact restrictions remain visible.'
 ],['Five source families have evidence-backed intake dispositions.','Adding a route never asserts access to restricted TAF data.'])
add(44,'5A','Add state finance, APCD and facility-source routes',[12,30,37],'R09','F15',
 'packages/connectors/source-registry/ evaluation/research-program/state-intake/ docs/research-program/source-coverage.md',
 'PHC4, APCD, facility licensure and closure tracking are represented with explicit state scope.',[
 'Define jurisdiction-scoped intake|Identify authoritative PHC4 products and selected state APCD/licensure sources from the frozen cohort. Preserve nongovernmental closure-tracking operator and methodology identity where applicable.|One state’s coverage never implies all-state completeness; publisher authority is not inferred from a familiar title.',
 'Add bounded portal configurations|Reuse existing Socrata/CKAN/DCAT/HTML/PDF adapters for documented routes. Preserve request/application paths when public machine access is unavailable.|A known portal/API boundary has a fixture and budget; scraping a public page does not bypass an application or DUA.',
 'Publish state-aware family cards|Expose state coverage, product types, reporting periods and supported access instructions. Record gaps by jurisdiction and source class.|The Pennsylvania finance task returns PHC4 alongside HCRIS without claiming identical reporting definitions or unrestricted payload access.'
 ],['All four families have precise geographic and access scope.','No national completeness claim is derived from a small state pilot.'])
add(45,'5A','Document HCUP, MEPS and AHA access workflows',[23,30,33,37],'R04 R09 R13','F15 F26',
 'packages/connectors/source-registry/ packages/identity/access-workflows/ evaluation/research-program/restricted-routes/',
 'Restricted, paid and public products have useful next steps without false access claims.',[
 'Separate products and access classes|Capture current publisher documentation for HCUP products, public/restricted MEPS variants and AHA Annual Survey. Record what is included, eligibility, fees/unknown fees, training and agreements.|Public MEPS files are not labeled restricted solely because another MEPS product is restricted; AHA terms are not inferred.',
 'Build evidence-backed workflow cards|Describe required actions, official application/download links, expected artifacts and documented turnaround or unknown. Never collect a user’s eligibility or credentials in USHSO.|Each step cites a source; an undocumented fee or eligibility criterion remains unknown rather than guessed.',
 'Verify human and machine route output|Test source-name discovery and route inspection for each product type; add guide links and explicit failure/blocked cases.|An agent can explain the next legitimate step and cannot claim a successful restricted-data download.'
 ],['All three families have accurate, current route evidence.','Catalog, license and payload access are separate dimensions.'])
add(46,'5B','Discover hospital MRF locators and schema versions',[2,9,11,12,34],'R10','F33',
 'packages/connectors/mrf/hospital-registry.mjs packages/identity/mrf/ tests/research-program/hpt-discovery.test.mjs',
 'The selected 25 hospitals have an auditable MRF locator/disposition.',[
 'Define hospital MRF identity|Bind hospital/facility identity, publisher locator, reporting date, declared schema version and file format. Support multiple facilities/files and source-native change history.|A health-system landing page is not counted as a verified file for every hospital it owns.',
 'Collect documented MRF links|Follow official hospital price-transparency pages and declared machine-readable locators through the bounded collector. Capture terms, size/encoding and link evidence.|Broken links, redirect gates and unexpected formats receive typed outcomes; no crawler explores arbitrary sites.',
 'Reconcile the hospital cohort|Produce exact selected/discovered/accessible/unresolved counts and a parser queue by version/format.|All 25 hospitals remain in the denominator, including failures; an enforcement dataset cannot satisfy a rate-file entry.'
 ],['Declared and detected schema versions are kept distinct.','No full-size MRF download is initiated without its own budget decision.'])
add(47,'5B','Parse bounded hospital JSON MRF samples',[8,19,46],'R05 R10','F33',
 'packages/connectors/mrf/hospital-json.mjs evaluation/research-program/mrf-fixtures/hospital-json/ tests/research-program/hpt-json.test.mjs',
 'Hospital JSON samples expose versioned item, charge and payer fields.',[
 'Pin official JSON schemas and fixtures|Vendor the selected CMS schema by commit/hash with its license and version. Start with current v3.0 and label historical-version support explicitly.|Official fictional examples are marked synthetic; the parser never reports an unknown newer version as compatible.',
 'Implement bounded streaming extraction|Read metadata and selected standard-charge items while preserving billing code system/version, setting, payer/plan, charge type, units and raw source pointers.|A budget stop yields a partial sample, not whole-file validation; numeric/string/percentage charge cases remain distinct.',
 'Normalize only supported JSON fields|Map values into the common pricing metadata schema, including 2026 allowed-amount elements when present. Preserve missing fields and non-dollar rate types.|No algorithm/percentage/per-diem value is automatically represented as a comparable dollar price.'
 ],['A bounded real source sample and official fixtures agree on parser semantics.','File-level schema validity is unknown unless the whole required structure was validated.'])
add(48,'5B','Parse hospital CSV MRF formats',[8,19,46,47],'R05 R10','F33',
 'packages/connectors/mrf/hospital-csv.mjs evaluation/research-program/mrf-fixtures/hospital-csv/ tests/research-program/hpt-csv.test.mjs',
 'Supported hospital wide/tall CSV files share the JSON metadata contract.',[
 'Pin wide and tall CSV layouts|Capture official CMS template/version definitions and representative header rows. Distinguish facility metadata rows from item rows and repeated payer columns.|A generic CSV header parser cannot misclassify a metadata row as the variable schema.',
 'Implement CSV layout adapters|Parse quoted/multiline fields, nulls and payer-specific columns with bounded rows/bytes. Preserve source column names and exact row locations.|Wide and tall synthetic representations yield equivalent selected charges without losing payer/plan associations.',
 'Verify cross-format equivalence|Compare JSON, wide CSV and tall CSV official examples through the same output contract and retain unsupported-layout failures.|Format equivalence applies to the fixture values only; it does not prove two real hospital files describe identical periods/services.'
 ],['All supported format/version combinations have explicit fixtures.','Partial or malformed rows remain visible and cannot fabricate zero prices.'])
add(49,'5C','Parse payer Transparency in Coverage indexes',[2,9,11,12,34],'R10','F33',
 'packages/connectors/mrf/payer-index.mjs packages/identity/mrf/ tests/research-program/tic-index.test.mjs',
 'Ten payer reporting entities have scoped plan/file inventories.',[
 'Define payer and file identity|Represent reporting entity, plan identity/type, market, network, update date, index URL and file type separately. Distinguish in-network, allowed-amount and provider-reference files.|An employer plan ID, insurer identity and hospital identity cannot be substituted for one another.',
 'Parse bounded table-of-contents indexes|Pin the official schema revision and follow only declared file references with duplicate/reference limits. Reconcile shared files across multiple plans.|The same file linked by many plans is fetched once but retains all supported plan associations.',
 'Build the payer cohort ledger|Record locator, size/encoding, declared version, access disposition and parser eligibility for each selected entity.|All ten reporting entities are accounted for; an inaccessible bulk file remains a valid documented route with failed sample state.'
 ],['Hospital HPT and payer TiC schemas remain separate.','Allowed-amount files are discoverable without pretending the in-network parser validates them.'])
add(50,'5C','Parse bounded payer in-network rate samples',[8,19,49],'R05 R10','F33',
 'packages/connectors/mrf/payer-in-network.mjs evaluation/research-program/mrf-fixtures/payer/ tests/research-program/tic-rates.test.mjs',
 'Payer samples preserve rate, code and provider-reference context.',[
 'Pin in-network schemas and rate fixtures|Retain CMS schema version/commit and cases for fee-for-service, bundle, percentage and other documented rate forms.|Unsupported schema/rate types are typed, not coerced into a dollar comparison.',
 'Stream selected rate objects|Bound bytes, decompression, item count and reference fan-out; preserve billing code type/version, modifiers, arrangement, service codes, rate expiration and references.|Stopping before end-of-file produces a partial-validation receipt; row order and file prefixes do not define a representative sample.',
 'Normalize the sample with caveats|Emit source pointers and exact rate dimensions through the pricing metadata contract. Describe what a research user can and cannot infer.|No utilization weights, patient liability or observed paid-price claims are generated from a negotiated-rate object.'
 ],['The parser does not load a giant file into Worker memory.','A rate without sufficient provider/network context remains incomplete.'])
add(51,'5C','Resolve payer provider references without identity shortcuts',[34,49,50],'R08 R10','F14 F33',
 'packages/connectors/mrf/payer-provider-reference.mjs packages/identity/mrf/ tests/research-program/tic-provider-reference.test.mjs',
 'Rate samples can identify the declared provider groups within the same file context.',[
 'Model inline and external references|Scope provider-group/reference IDs to the reporting file/version and preserve NPI/TIN type/value as documented. External references are separate bounded resources.|Equal numeric reference IDs in different files cannot be joined accidentally.',
 'Resolve bounded reference closures|Fetch/parse only the required declared reference objects under source budgets; detect missing references and cycles without unbounded expansion.|A missing referenced object yields an unresolved association; no provider group is invented from a hospital name.',
 'Expose reference completeness|Attach resolved/unresolved group counts, context and evidence to the rate sample. Keep facility mapping a separate qualified join.|An NPI-bearing rate does not automatically map to a hospital CCN or a complete facility roster.'
 ],['Reference closure has explicit count and byte limits.','Source-local reference resolution never performs an implicit cross-source identity merge.'])
add(52,'5D','Validate price dimensions and sample quality',[32,47,48,50,51],'R05 R10','F33',
 'packages/identity/mrf/price-semantics.mjs evaluation/research-program/mrf-validation/ tests/research-program/price-semantics.test.mjs',
 'Price previews state their scope and block invalid comparisons.',[
 'Define comparable price context|Require code system/version/modifiers, service setting, charge/rate type, payer/plan/network, unit, provider context and effective period as applicable.|A gross charge, discounted cash price, negotiated amount and allowed amount remain different measures.',
 'Add quality and compatibility checks|Flag missing required context, malformed dates, invalid values, duplicate exact rows and conflicting rates. Keep full-file validity separate from sampled checks.|Missing or negative/zero values are investigated by documented semantics, not universally dropped or treated as valid prices.',
 'Produce sample-validation summaries|Report parsed rows, checked fields, unresolved references, failed rules, byte scope and excluded comparisons. Preserve 2026 schema-specific field differences.|A passing sample does not imply legal compliance, complete hospital reporting or comparable patient costs.'
 ],['The implementation uses current pinned CMS definitions, not an obsolete generic MRF schema.','All unsupported price comparisons have specific reasons.'])
add(53,'5D','Publish hospital and payer MRF directory profiles',[30,46,49,52],'R09 R10 R11','F33',
 'packages/registry/mrf-repository.mjs packages/search/ packages/coverage/ tests/research-program/mrf-publication.test.mjs',
 'MRFs become discoverable products with useful sample and access metadata.',[
 'Create versioned MRF product profiles|Include entity, release, file types, locator, size, schema support, tested state, sample scope and price caveats. Reuse source-card/evidence contracts.|A profile can explain a blocked file without claiming a sample exists; separate files/releases retain stable identities.',
 'Index pricing-specific discovery dimensions|Support hospital versus payer, geography supported by evidence, file/schema version, tested availability and code/rate types. Keep uncertain facility mappings out of exact filters.|A query for negotiated rate files does not lead with enforcement outcomes as a compatible file.',
 'Publish reconciled MRF coverage|Add cohort denominators and source-profile links to the public generation. Validate each record’s sample/locator/context references.|Counts represent hospitals/reporting entities/files separately; shared files do not inflate provider coverage.'
 ],['All selected MRF profiles have a visible success or failure disposition.','Price profiles are available through the same repository ports as other sources.'])
add(54,'5D','Qualify the MRF pilot and author pricing research examples',[41,43,44,45,53],'R09 R10 R13','F15 F33',
 'evaluation/research-program/mrf-examples/ docs/research-program/mrf-methods.md scripts/research-program/qualify-mrf.mjs',
 'MRF discovery has demonstrated research tasks and an honest pilot coverage report.',[
 'Write hospital and payer walkthroughs|Use one qualified example of each to explain locating a file, inspecting schema, finding a code/rate, resolving references and identifying non-comparable dimensions.|Every example operation links to its exact sample/metadata receipt; real and fictional examples are explicitly labeled.',
 'Reconcile pilot acceptance|Check 25 hospital/10 payer dispositions and at least 20/eight successful bounded parsed samples. Report reasons for failures and limits of geographic/market representation.|A failed target stays a blocker with a bounded follow-up task; do not replace difficult cohort members.',
 'Publish the pricing methods and coverage packet|Explain historical/current schemas, sampling bias, stale rates, duplicate/shared files, missing references, price definitions and citations. Confirm all twelve expansion families also have routes.|A reviewer can reproduce the pricing task without mistaking a rate for observed payment or a legal-compliance judgment.'
 ],['MRF functionality is demonstrable rather than a roadmap placeholder.','The product remains a discovery/research layer, not an unbounded national rate warehouse.'])

add(55,'6A','Return real release and distribution collections',[7,30,33,53],'R11','F19 F21',
 'worker/static-machine-toolkit-service.mjs packages/machine-toolkit/src/service.mjs packages/registry/ tests/research-program/machine-assets.test.mjs',
 'get_asset gives clients the actual context required for follow-up calls.',[
 'Read accepted asset context collections|Map canonical product/source/releases/distributions/documentation/schemas through repository ports rather than static unknown placeholders.|HCRIS has positive contextual collections while an unbound product stays explicitly unknown.',
 'Page and pin each collection|Use existing bounded collection limits/cursors and generation mapping. Preserve known-empty versus not-yet-resolved collections.|Pagination across a generation change returns a typed restart; limits never silently clip required context.',
 'Verify client discovery of follow-up IDs|Exercise search to get_asset and select a real release/distribution/schema for later tools. Update exact examples in agent docs.|The client obtains IDs from actual output; tests do not inject fake release IDs to manufacture a positive path.'
 ],['Machine asset context agrees with the public detail page.','Three collection states complete/partial/unknown remain distinguishable.'])
add(56,'6A','Serve actionable access plans and retrieval recipes',[19,33,45,55],'R04 R11','F02 F19 F20',
 'worker/static-machine-toolkit-service.mjs packages/machine-toolkit/src/service.mjs packages/identity/access-workflows/ tests/research-program/machine-recipes.test.mjs',
 'The access/recipe tools can describe tested public and verified manual routes.',[
 'Map qualified route contexts|Use accepted release/distribution/access-route IDs and documented requirements. Keep source-side authorization separate from USHSO’s metadata operation.|Public CMS, keyed Census and restricted HCUP fixtures produce different legitimate next steps.',
 'Return tested recipes and precise limits|Include method, endpoint template, parameter meanings, required credentials by name only, pagination, expected schema and latest test receipt. Include scan-friendly documented credential/cost/quota requirements separately from observed checks, with unknowns and latest-success/latest-attempt scopes. Return cURL/Python examples generated from tested recipes with exact wire fields, request bounds and source/release pins. Keep endpoint-specific browser/CORS results in the developer recipe context, with tested origin/method/credential mode or an explicit untested state.|A returned recipe contains no secret or source payload; it does not execute merely because a client inspected it. Human and machine access summaries agree, missing cost/quota information stays unknown, and generated example parameters reproduce the validated recipe without embedding a credential.',
 'Replace generic retry guidance|For missing context, point to the exact discover/get_asset action or source documentation. Retry only when the recorded error is transient.|Nonretryable route_not_documented no longer tells clients to retry blindly against unchanged metadata.'
 ],['Both tools have real positive paths and explicit restricted/unresolved cases.','Machine response bounds and no-acquisition policy remain enforced.'])
add(57,'6A','Expose qualified variables and proposal status coherently',[8,29,55],'R05 R11','F10 F11 F19',
 'worker/dictionary-review-router.mjs worker/static-machine-toolkit-service.mjs packages/machine-toolkit/src/service.mjs tests/research-program/machine-variables.test.mjs',
 'get_variables serves exact contextual fields; proposals remain separately inspectable.',[
 'Read accepted variable contexts|Resolve schema/release/distribution IDs from get_asset and expose exact wire names, definitions, units/states, allowed values and evidence.|The positive HCRIS fixture uses accepted wire mappings; unapproved documentation does not leak into the canonical schema.',
 'Support bounded variable search and paging|Implement exact-name/label matching and required field filters using indexed dictionary pages. Preserve supplement and truncation metadata.|A 154-field dictionary traverses without omissions/duplicates, and oversized fields retain their documented retrieval path.',
 'Explain unresolved dictionary states|Return targeted guidance for no schema context, missing dictionary and pending proposals. Link proposal inspection without changing scientific status.|A known dictionary proposal is visible as a proposal, while get_variables remains honest about an unbound schema.'
 ],['The user no longer needs to know an invented schema ID.','Canonical and review-only data cannot be confused in client responses.'])
add(58,'6B','Publish a self-consistent machine contract bundle',[55,56,57],'R11','F19 F21 F29',
 'contracts/machine-toolkit/ packages/machine-toolkit/public-webmcp-tool.json worker/index.mjs tests/research-program/schema-closure.test.mjs',
 'Public contract files and examples actually describe deployed operations.',[
 'Version the changed input/output contracts|Add accepted field/context changes additively where possible and document incompatible versions. Preserve old contract IDs and explicit migration behavior.|Old clients receive supported compatibility or a typed version error, not a silently different response shape.',
 'Publish all transitive schema references|Build a self-contained contract manifest and serve every referenced schema as JSON. Keep same-origin routing and typed missing-file behavior.|Fetch/compile the actual served schema closure; HTML fallback for a schema URL fails the test.',
 'Generate capability and example manifests|Derive /api/contract, tool definitions, input examples and enabled counts from one definition source. Keep the planner disabled until its own acceptance is met.|Exactly the advertised tools and versions exist; the agent guide does not publish stale generation labels.'
 ],['All eight actual response envelopes validate against the served schemas.','Protocol success and scientific-result states remain separate.'])
add(59,'6B','Harden ordinary client pagination and recovery behavior',[55,56,57,58],'R11','F20 F21',
 'packages/machine-toolkit/src/ worker/machine-cursor.mjs plugins/ushso-research/scripts/client.mjs tests/research-program/client-recovery.test.mjs',
 'Clients recover from expected source/generation limits without guessing.',[
 'Unify cursor and generation guidance|Map expired, malformed and wrong-generation cursors to precise restart instructions that preserve the research question and disclose snapshot change.|A cursor for one tool/query cannot page a different collection; an expired cursor never silently begins a new generation.',
 'Preserve typed domain results|Keep partial, unknown, empty, unavailable and blocked separate through HTTP/client envelopes. Align retryable flags and corrective actions.|An unknown schema is not returned as an empty list of variables or a transport success claiming the task completed.',
 'Verify cancellation and output limits|Exercise cancellation, slow responses, bounded collection output and oversize handling through the real client transport fixtures.|Cancellation stops the current request; clients neither retry nonretryable states nor lose the next-cursor/omitted-section explanation.'
 ],['Recovery behavior is documented with runnable examples.','No acceptance check depends solely on status 200.'])
add(60,'6B','Make the MCP plugin install and setup reproducible',[58,59],'R11 R13','F19 F23',
 'plugins/ushso-research/ docs/research-program/mcp-setup.md tests/research-program/mcp-install.test.mjs',
 'A new developer or agent can install the actual eight-tool client.',[
 'Validate plugin packaging and startup|Ensure packaged scripts, tool manifests and dependencies exist in a clean install. Document exact supported transport/runtime and public origin selection.|A clean temporary installation initializes, lists tools and exits without depending on the development checkout.',
 'Add novice and advanced setup instructions|Show initialization, source search, get_asset, variables/recipe, pagination and evidence interpretation with actual contract inputs. Explain WebMCP browser requirements separately from stdio MCP.|Instructions avoid promising native WebMCP in unsupported browsers; the HTTP route remains a tested fallback.',
 'Run actual MCP protocol journeys|Start the packaged server over stdio; perform initialize, tools/list and complete source-inspection workflows with typed negatives and generation restart.|Retain JSON-RPC requests/responses and exact plugin version; a mocked dispatch function is insufficient final evidence.'
 ],['Marketplace UI installation is claimed only if actually tested.','No tool named in the guide is silently disabled or missing.'])
add(61,'6C','Expose research comparison and evidence packet APIs',[36,41,55,56,57],'R08 R11','F14 F27',
 'packages/machine-toolkit/src/service.mjs packages/registry/ tests/research-program/machine-research-packet.test.mjs',
 'Agents can compare source suitability and export a reproducible metadata packet.',[
 'Return supported comparison dimensions|Populate compare_assets with actual access, dates, grain, field and verification dimensions; retain unknown/not-comparable states.|Comparing HCRIS and PHC4 shows differing reporting definitions rather than a generic complete result with empty facts.',
 'Integrate qualified join route inspection|Serve the reviewed routes with exact contexts, matched/unmatched evidence scope and caveats. Keep unsupported two-hop composition explicit.|An individually valid pair of joins cannot be promoted to a valid combined path without compatibility checks.',
 'Provide a versioned evidence packet export|Bundle source selections, contexts, recipes, variable citations, comparisons and join metadata in a bounded downloadable response.|The export can be validated offline and reproduces source identities without invoking LLMs or fetching source data.'
 ],['Comparison completeness is about populated relevant dimensions, not envelope construction.','Exports contain no credentials or hidden research-query telemetry.'])
add(62,'6C','Qualify a bounded research-plan compilation workflow',[2,41,42,54,61],'R04 R11','F19 F27',
 'packages/planner/ apps/web/src/pages/PlanPage.tsx contracts/machine-toolkit/ tests/research-program/planner-qualification.test.mjs',
 'The disabled planner has a concrete path to useful, evidence-bound enablement.',[
 'Define planner acceptance and output scope|Reuse existing planner interfaces to compile user-selected sources and documented contributions into a metadata plan. Preserve unresolved needs and explicit human access steps.|No invented dataset, field, join or analysis output can appear; insufficient evidence returns an incomplete plan.',
 'Implement deterministic plan composition|Assemble goal, sources, fields, access steps, qualified joins, limitations and citations from the accepted generation. Keep actual acquisition/analysis outside invocation.|The same pinned selections produce the same plan; missing required sources remain a named gap.',
 'Prepare gated activation evidence|Test positive finance/geography/pricing plans and forbidden assumptions, then prepare the exact capability/contract/UI change for Astra and owner review. Keep disabled until the relevant boundary is explicitly resolved.|The eight existing tools continue working if planner activation is not accepted; no status text claims an enabled planner prematurely.'
 ],['Planner activation is not an incidental side effect of adding fields.','An accepted plan compiles documented steps; it does not certify a study design.'])
add(63,'6C','Independently verify HTTP, MCP and WebMCP parity',[58,59,60,61,62],'R11 R16','F19 F20 F21',
 'verification/research-program/machine/ scripts/research-program/verify-machine.mjs',
 'All enabled machine features have actual cross-transport evidence.',[
 'Create one cross-transport scenario set|Use exact priority source contexts and output expectations for every tool, including positive, partial, unknown, restricted and missing-source cases.|Do not use made-up schema IDs for the positive path; fixtures explicitly distinguish protocol and research success.',
 'Invoke real clients on the candidate|Run HTTP requests, a packaged stdio MCP server, and native browser discovery/invocation against the same staged generation. Retain sanitized exchanges.|All advertised tools are discovered and callable; browser unavailability is recorded as untested rather than passed.',
 'Compare scientific and identity fields|Normalize only transport envelope differences and compare source IDs, context, fields, evidence, access and join states. Have Astra independently replay decisive scenarios.|A discrepancy blocks qualification even if each transport passed its own producer tests.'
 ],['Cross-transport agreement is verified on a candidate artifact, not inferred from shared source code.','All current disabled-feature boundaries remain explicit in the result.'])

add(64,'7A','Create clear beginner, researcher and developer navigation',[5,33,41],'R12 R13','F23 F24 F28',
 'apps/web/src/App.tsx apps/web/src/components/ObservatoryHeader.tsx apps/web/src/pages/LandingPage.tsx apps/web/src/pages/LearnPage.tsx',
 'People can understand the product and choose an appropriate starting route.',[
 'Define the information architecture|Add Explore, Learn, Coverage, About and Developers destinations within the existing design language. Map each page to a real user question and a verified source example.|Every navigation destination resolves to useful content; disabled features are not promoted as primary actions.',
 'Rewrite home around the mission|Explain source discovery, evidence-backed previews and tested access in plain language. Add three tested example journeys and visible current coverage/verification scope.|Claims match the accepted generation; a beginner can distinguish finding a source from obtaining restricted data.',
 'Implement responsive navigation|Keep semantic links, keyboard focus, small-screen menu behavior and a persistent path back to learning material. Use shared header/footer components.|At 320px and 390px menus remain usable without overflow and every entry has a descriptive accessible name.'
 ],['A new visitor can identify why and how to use USHSO from the first screen.','Existing brand/visual conventions are preserved for Astra final refinement.'])
add(65,'7A','Make search results concise and decision-oriented',[6,33,38,40,64],'R07 R12','F17 F24 F25',
 'apps/web/src/pages/SearchResultsPage.tsx apps/web/src/components/ResultCard.tsx apps/web/src/components/FacetSidebar.tsx apps/web/src/styles.css',
 'Researchers see useful matches and meaningful filters without repeated technical boilerplate.',[
 'Define the compact result hierarchy|Show source/product, purpose, essential coverage/grain/time, tested access state and a specific next action. Move detailed evidence and generation hashes into expandable sections.|No essential limitation disappears; inferred and observed dimensions retain their distinct labels.',
 'Use effective filters and family grouping|Offer human-readable supported facets, explicit unknown inclusion and evidence-backed product/release grouping. Keep filter state shareable and counts scoped.|Filtering by a known geography does not treat unknown as a confirmed match; contextual sources are visibly separated.',
 'Reduce mobile pre-result overhead|Collapse routine interpretation/count receipts and summarize catalog-wide warnings once. Ensure a real result begins in the initial 390px by 844px search viewport after load.|Capture before/after on the same query; test pagination, sorting, filter dialog focus and return navigation.'
 ],['The maternal/infant negative case remains corrected.','A short card is not allowed to conceal unresolved essential research context.'])
add(66,'7A','Build a useful source detail and preview page',[33,40,55,56,57,64],'R04 R05 R12','F11 F26',
 'apps/web/src/pages/DatasetDetailsPage.tsx apps/web/src/components/SourceSummary.tsx apps/web/src/components/VariableBrowser.tsx apps/web/src/styles.css',
 'A source page answers what it contains, how to use it and what has actually been tested.',[
 'Put the source decision first|Lead with purpose, exact product/release, observed coverage/grain, access requirements, last test and a clear source action. Consolidate repetitive unresolved sections. Make credential requirements, access costs, usage limits and the latest successful check easy to scan, distinguishing documented requirements from observed behavior and metadata checks from payload checks. Keep endpoint-specific browser/CORS detail alongside developer recipes.|The HCRIS page does not claim source-asserted inferred units or hide its supported API example below boilerplate. Unknown cost/limits remain visible, and a reachable documentation page cannot be presented as proven payload or browser access.',
 'Add contextual variable and sample inspection|Provide searchable fields, exact wire names, definitions, unit states, code values and a bounded actual/synthetic example label. Keep pending proposals in a distinct review region.|Fields and preview match the selected release/distribution; changing context cannot retain an incompatible cached dictionary.',
 'Make evidence and correction actions specific|Attach citations, test receipts and field-level corrections to the visible values; expose important caveats before export or source navigation.|A correction contains record/generation/field information without automatically including the user’s private research question.'
 ],['Novice and expert readers can reach relevant information at different depths.','No unverified value is added merely to fill the layout.'])
add(67,'7B','Add a local research shortlist',[41,64,66],'R12','F27',
 'apps/web/src/lib/shortlist.ts apps/web/src/pages/WorkspacePage.tsx apps/web/src/components/ResultCard.tsx',
 'Users can retain selected sources without needing an account.',[
 'Define a versioned shortlist record|Store selected product/context IDs, generation and optional user-entered notes locally. Keep explicit clear/export controls and a documented storage policy.|No credentials or source payloads enter local storage; private notes are never automatically sent to enrichment or telemetry.',
 'Implement add/remove and restore|Add visible controls on results/detail and a workspace list using canonical IDs. Detect unavailable or changed generations on reload.|Duplicate clicks do not duplicate a source; stale entries retain their original context and offer explicit refresh.',
 'Support accessible shortlist management|Provide keyboard operations, status announcements, empty state and count. Link each selection back to its exact source context.|A user can select sources, navigate away, return and deliberately clear the list on desktop/mobile.'
 ],['All persistence is disclosed and user controlled.','Shortlist success does not mean the source is scientifically suitable.'])
add(68,'7B','Add human source comparison and research workflow',[61,62,66,67],'R08 R12','F27',
 'apps/web/src/pages/ComparePage.tsx apps/web/src/pages/WorkspacePage.tsx apps/web/src/pages/PlanPage.tsx',
 'Humans can compare selected sources and assemble a supported research workflow.',[
 'Build evidence-based comparison views|Show coverage, grain, time, measures, access, test status and join compatibility for two to five sources using the shared API result.|Unknown and not-comparable dimensions are explicit; no numeric overall quality score hides the differences.',
 'Connect selections to documented steps|Display the accepted research packet or gated plan output with source contributions, field requirements, access actions and missing needs.|If planner remains disabled, the workspace still offers supported comparison/export and does not imply plan compilation occurred.',
 'Test financial and pricing decisions|Walk through HCRIS/PHC4 and hospital/payer MRF comparisons. Keep price types and reporting periods clear in narrow layouts.|A beginner cannot mistake negotiated rates for patient bills based on the comparison labels; advanced context remains inspectable.'
 ],['Human comparisons use the same evidence as compare_assets.','The user always sees why a selected pair may not join or compare.'])
add(69,'7B','Export citations and reproducible research packets',[41,61,67,68],'R11 R12 R13','F27',
 'apps/web/src/lib/citations.ts apps/web/src/lib/researchExport.ts apps/web/src/pages/WorkspacePage.tsx',
 'Source selections can be cited and handed to another researcher or agent.',[
 'Define citation formats|Generate plain-text, BibTeX/RIS and machine-readable source citations from publisher, product, release, canonical locator and observed/accessed dates. Mark absent DOI/license data honestly.|Do not invent authors, DOI, release year or publisher endorsement; output escaping preserves special characters.',
 'Export the evidence packet|Include selected sources, contexts, fields, recipes, limitations and receipt links; let users explicitly choose whether to include their question/notes.|Exports exclude credentials and default to source evidence only; they validate against the versioned packet schema.',
 'Verify re-import and citation fidelity|Open an exported packet in a clean client and resolve retained contexts or typed retired-generation states. Provide a readable summary alongside JSON.|The exported source order and generation agree with the UI; reproducing a selection does not silently re-run a different search.'
 ],['A cited source is the publisher’s product, with USHSO verification identified separately.','A junior researcher can share a useful packet without explaining internal hash formats.'])
add(70,'7C','Write beginner learning and API quick-start guides',[41,54,60,64,66],'R12 R13','F23 F24',
 'apps/web/src/content/learn/ apps/web/src/pages/LearnPage.tsx scripts/research-program/check-guide-examples.mjs',
 'Beginner users and new developers have complete, tested starting instructions.',[
 'Write the beginner learning sequence|Create What USHSO does, Your first source search, and How to read a source page. Define dataset, API, file, release, variable, grain and access in context.|Each guide leads to a real next action and a verified example, not a generic glossary dump.',
 'Write access and developer quick starts|Cover public downloads, API keys, applications/DUAs, Python/R/curl examples and MCP setup. Explain which actions happen at the publisher. Prefer cURL/Python examples generated from tested canonical recipes, preserving credential placeholders, exact wire names, bounded parameters and source/release identities.|A new user can follow the documented prerequisites; code examples use exact wire keys and never embed a credential. Guide examples retain the same request and response bounds as their source recipe; credential-blocked or untested paths state their actual status.',
 'Validate and cross-link examples|Run eligible example commands through the shared bounded test harness and check links/anchors against the candidate site. Version examples with source generation.|Failed/currently gated examples display the actual outcome and next step rather than a fabricated success screenshot.'
 ],['The main learning route is reachable from home and source pages.','Introductory copy contains no unexplained implementation vocabulary.'])
add(71,'7C','Write advanced research and MRF methods guides',[31,32,36,39,54,69,70],'R08 R12 R13','F10 F14 F22 F33',
 'apps/web/src/content/learn/ apps/web/src/pages/MethodsPage.tsx',
 'Advanced users can assess variable meaning, linkage and pricing limitations.',[
 'Document scientific source assessment|Explain population/universe, grain, denominator, weights/MOE, suppression, date roles, schema drift and appropriate non-use with evidence-backed examples.|Maternal/infant mortality and fiscal/calendar periods are shown as concrete distinctions, not a blanket disclaimer.',
 'Document joins and MRF research|Teach identifier systems, mapping loss/cardinality, geographic vintages, hospital versus payer files, rate types and sampling limits. Link qualified examples and source definitions.|No guide recommends CCN=NPI, name-only merging or inferring observed payments from negotiated-rate files.',
 'Publish current evaluation and citation methods|Explain cohort denominators, present-source versus full-universe recall, label uncertainty, current results and reproduction. Keep old evaluation clearly historical.|The Methods page names exact current artifacts and failure scope; all published quantitative claims have a receipt.'
 ],['Expert documentation adds practical depth without obstructing beginner workflows.','Source standards are pinned and links checked during each documentation release.'])
add(72,'7C','Complete About, accountability and correction guidance',[64,69,70,71],'R12 R13','F28',
 'apps/web/src/pages/AboutPage.tsx apps/web/src/pages/ContactPage.tsx apps/web/src/pages/StandardPage.tsx apps/web/src/content/learn/',
 'USHSO explains its mission, operator and editorial responsibilities plainly.',[
 'Rewrite About around user benefit|Explain the mission, intended users, AJHCS operation, scope and concrete research examples. Retain a clear independent/non-governmental identity.|Copy does not invent affiliations, staff, funding or outcomes; known operator details remain consistent with production.',
 'Prepare exact disclosure and service text|Add owner-supplied funding/conflict information and named editorial/correction roles when provided. Present missing disclosures accurately and prepare a proposed correction response policy for review.|Unsupplied facts remain unsupplied; no engineer fills them using an LLM or guesses a response-time promise.',
 'Connect corrections and policies to use|Explain field-level corrections, private contact, issue status, citation/version updates, local shortlist storage and source-specific rights. Keep info@ushso.org as the verified public contact.|All correction routes work without exposing private forwarding addresses or automatically attaching sensitive user content.'
 ],['About is a useful introduction, not solely a technical boundary statement.','Policy changes accurately describe the implemented product behavior.'])
add(73,'7D','Verify keyboard and assistive-technology workflows',[65,66,67,68,69,70,71,72],'R12 R13 R16','F24 F25',
 'apps/web/src/components/ apps/web/src/styles.css tests/research-program/browser-accessibility.mjs verification/research-program/frontend/',
 'Core research tasks are accessible with documented tested limits.',[
 'Audit semantic structure and controls|Review labels, headings, table relationships, expandable evidence, errors, skip links and live status against the agreed WCAG 2.2 AA target.|Automated checks identify issues but do not alone certify accessibility; preserve their actual findings.',
 'Fix keyboard and focus behavior|Exercise search, menus, filters, dictionary paging, shortlist, comparison and export without a mouse. Restore focus after dialogs and back navigation.|No keyboard trap, hidden focused control or lost context on route changes; target sizes/contrast are measured.',
 'Run assistive-technology task checks|Use a real supported screen reader/browser combination for selected novice/expert tasks and retain an outcome log. Record untested combinations honestly.|An implementation passes only the named combinations; unresolved critical accessibility failures block frontend acceptance.'
 ],['Accessibility verification includes actual interactions and assistive technology.','No conformance claim is inferred from screenshots or one scanner.'])
add(74,'7D','Verify mobile, browsers and discoverable source pages',[58,65,66,69,73],'R12 R13 R16','F25 F29',
 'apps/web/src/ packages/web-discoverability/ worker/index.mjs tests/research-program/browser-matrix.mjs',
 'Source pages work across viewports and expose useful content to crawlers.',[
 'Provide bounded public source representations|Reuse web-discoverability interfaces to serve canonical source titles, summaries, evidence/version links and structured metadata in HTML/JSON. Update sitemap with Methods/guides and eligible source pages.|An HTML-only crawler sees meaningful source content; unknown data fields are not invented for structured markup.',
 'Test the browser and viewport matrix|Exercise the same frozen tasks in current Chromium, Firefox and WebKit/Safari-equivalent coverage with 320/390/768/1440px layouts and zoom checks.|Record actual engines/devices; an emulator is not claimed as a physical-device test.',
 'Verify navigation and loading failures|Test direct deep links, Back/Forward, slow/offline assets, invalid records and changed generations. Keep a first useful result visible promptly on mobile.|No blank detail page or silent stale-context substitution; sitemap and canonical URLs resolve to their intended content.'
 ],['Browser-specific WebMCP availability is distinct from ordinary site usability.','Source/guide SEO content agrees with the same canonical generation.'])
add(75,'7D','Apply Astra final frontend and content review',[64,65,66,67,68,69,70,71,72,73,74],'R12 R13 R16','F23 F24 F25 F26 F28',
 'apps/web/src/ verification/research-program/frontend/final-review.md',
 'The complete site reads clearly and presents real research content with consistent visual quality.',[
 'Review the complete rendered journeys|Astra inspects fresh desktop/mobile screenshots and actual task behavior across home, search, detail, variables, pricing, workspace and guides. Prioritize scientific clarity and next actions.|Record concrete issues against screenshot/route/state; do not rely on implementer claims or reused old captures.',
 'Refine hierarchy, spacing and copy|Make the necessary final component/style/content edits within the established brand. Reduce repetitive warnings, internal identifiers and empty scaffolding while preserving material limits.|Compare before/after at identical viewports; every factual claim still maps to accepted source evidence.',
 'Capture final interaction evidence|Re-run affected tasks and record keyboard/mobile/browser outcomes, export accuracy and console findings on the reviewed candidate.|No placeholder sample, dead control, invented disclosure or known critical UI issue remains in the accepted journey set.'
 ],['Astra owns this final frontend PR and independently reviews earlier UI work.','A beautiful page with unsupported data cannot pass.'])

add(76,'8A','Operate refresh schedules and actionable monitoring',[12,24,30,53],'R03 R14 R15','F07 F32',
 'services/scheduler-worker/ services/harvest-worker/ infra/ docs/research-program/operations.md',
 'Freshness and data-quality changes are maintained by an observable bounded process.',[
 'Configure measured source refresh schedules|Use per-axis/source priorities, publisher cadence, changed-content hashes and last success/attempt. Reuse job leases/outbox and document environment-specific activation.|Refresh schedules fit the selected source/spend budgets; a stale source is visible even when no collector ran successfully.',
 'Add actionable operational signals|Track queue age, failed checks, schema drift, coverage loss, budget exhaustion and review backlog. Notify on meaningful changes with affected sources and next action. Monitor redirect destination and resource-role drift separately from HTTP reachability, using the PR011 EPA API-link-to-Widgets case as a dated regression fixture.|Repeated unchanged failures do not generate routine notification spam; critical new loss is not hidden by aggregate success. A successful HTTP response with the wrong resource role produces a specific changed-destination signal and cannot refresh an actionable API success badge.',
 'Prepare and verify runtime activation|Render scoped scheduler/collector deployment configuration and run fixture/staging cycles. Obtain concrete operational authorization only after the tested artifact and rollback are reviewable.|Public Worker has no source credentials or fetch capability; production activation is separately receipted.'
 ],['No timer or service is enabled by merely merging configuration files.','Two complete scheduled cycles must produce reconciled outcomes.'])
add(77,'8A','Measure indexing, delivery capacity and operating cost',[24,30,53,63,74,76],'R14 R15 R16','F30 F32',
 'packages/search/ scripts/research-program/capacity.mjs verification/research-program/performance/ docs/research-program/costs.md',
 'Runtime and storage choices are justified by current-cardinality measurements.',[
 'Define the real workload and budgets|Pin corpus/dictionary sizes, query mix, cold/warm definitions, concurrency, regions, response sizes and source-job contention. Compare existing deployment requirements with proposed SLOs explicitly.|No accepted old performance gate is silently weakened; targets and cost ceilings are named before measurement.',
 'Benchmark bounded indexed delivery|Measure actual candidate query/detail/variables/MRF metadata paths at current and twice planned load. Profile memory/CPU/storage/asset counts and compare any proposed index/cache topology.|A small fixture or warm-only average cannot qualify cold starts or production capacity; output parity remains exact.',
 'Choose and document the measured topology|Retain the lowest-cost option satisfying quality, capacity and rollback requirements. Prepare any required ADR/procurement change with evidence instead of assuming premium infrastructure.|Report steady and burst costs, provider fees, storage and review operations; failed targets remain unresolved until fixed.'
 ],['Performance results distinguish browser time, edge/network latency and upstream collection.','No source acquisition happens during a user search.'])
add(78,'8A','Verify recovery, retention and production configuration',[9,30,59,76,77],'R02 R15 R16','F31 F32',
 'infra/recovery/ docs/research-program/operations.md verification/research-program/recovery/ worker/index.mjs',
 'The system can recover without losing evidence or silently changing public truth.',[
 'Exercise evidence and publication recovery|Restore a staged evidence/accepted-metadata snapshot and return to N−1 publication using existing recovery ports. Preserve attempts and review histories.|Measure actual restore/rollback time; a configuration file or backup listing alone is not a recovery drill.',
 'Verify retention and key operation|Check sample/metadata retention classes, quota behavior, job stop/replay, credential rotation and cursor invalidation through scoped tests. Keep secrets out of logs.|Deletion/rotation tests use fixtures or staging; historical approved evidence is not erased to make integrity checks pass.',
 'Resolve configuration and console inconsistencies|Decide whether the unwanted Insights injection should be removed or intentionally configured under the site’s privacy/CSP policy. Align health/readiness signals with actual dependencies.|Fresh browser captures show the selected behavior without unexpected script errors; CSP is not broadly weakened as a shortcut.'
 ],['Operational documentation matches actual tested configuration.','Failure recovery cannot publish pending scientific claims.'])
add(79,'8B','Run independent whole-program data acceptance',[21,27,39,42,54,63,77,78],'R01 R02 R03 R04 R05 R06 R07 R08 R09 R10 R11 R14 R15','F01 F02 F03 F04 F05 F06 F07 F08 F09 F10 F11 F12 F13 F14 F15 F16 F18 F19 F20 F21 F22 F30 F32 F33',
 'verification/research-program/acceptance/ scripts/research-program/verify-data-program.mjs',
 'Astra has reproducible evidence that the data/API program meets its stated targets.',[
 'Recompute all catalog and field denominators|Use accepted canonical records, attempt logs, dictionary/schema bindings, source intake and MRF cohorts. Validate references, uniqueness, exclusions and clock-based freshness.|Every baseline ID and every selected cohort member reconciles; no success total counts missing or unattempted work.',
 'Replay decisive research/data checks|Independently rerun sample/schema-key reconciliation, scientific negative cases, fifteen joins, source coverage, model quality and all machine transports.|Astra’s receipt identifies exact commands/artifacts; producer logs are supporting material rather than the independent result.',
 'Issue a requirement-by-requirement result|For R01–R11/R14–R15, mark pass/fail/unverified with evidence and remaining scope. Open bounded remediation PRs for any deficit and rerun affected acceptance.|Do not declare the program complete because all originally planned PRs merged; actual requirement failures block release qualification.'
 ],['Full-catalog review and sampled upstream validation are clearly distinguished.','The accepted result names the exact candidate and all evidence limitations.'])
add(80,'8B','Validate beginner and expert task completion',[2,41,54,63,75],'R12 R13','F23 F24 F25 F26 F27 F28',
 'evaluation/research-program/usability/ docs/research-program/usability-results.md',
 'Real intended users can use the product and interpret its limitations correctly.',[
 'Prepare a reproducible moderated protocol|Specify eight novice/eight advanced participants, frozen tasks, success criteria, help rules and non-PHI notes. Separate human participants from agent simulations.|Tasks test finding, interpreting, accessing and citing sources; merely clicking through a page is not completion.',
 'Collect consented task evidence|Run the protocol or ingest documented sessions from the product owner/research facilitator. Record completion, critical misunderstandings, observed friction and untested cases.|If participants are unavailable, retain unverified status; implementer self-tests cannot satisfy R12.',
 'Report and route concrete failures|Compute completion by group and task, with counts and limitations; create targeted fixes for access/grain/price misunderstandings and poor navigation.|Require ≥85% completion in each group and no critical misunderstanding; tiny-group results are product acceptance evidence, not a population-wide usability claim.'
 ],['The beginner and advanced cohorts are evaluated separately.','Testing materials never require participants to submit protected research data.'])
add(81,'8B','Close acceptance gaps and assemble reviewer evidence',[3,72,75,79,80],'R12 R13 R16','F01 F22 F23 F24 F25 F26 F27 F28',
 'verification/research-program/acceptance/index.json docs/research-program/review-summary.md',
 'A reviewer can determine whether the full product is ready without reading implementation chats.',[
 'Reconcile all requirement and finding outcomes|Map each R01–R16 and F01–F33 to exact accepted PRs, commits, test receipts and any remaining limitation. Verify that findings marked closed no longer reproduce.|A missing witness or failed requirement remains open regardless of model consensus or code completion.',
 'Verify handoff and documentation closure|Check every merged assignment packet, source/example guide, operational runbook and publication manifest. Confirm owner disclosures and current source contracts are consistent.|No orphan artifact, undeclared exception, stale dependency or missing review note is hidden in the release package.',
 'Prepare Astra final review findings|Record independent technical/scientific/UI conclusions and the exact outstanding decisions, if any. Keep production/spend decisions concrete and separate.|Only a fully evidenced candidate proceeds to release preparation; the review cannot grant itself owner authority.'
 ],['All source and UI examples remain valid on the same candidate generation.','Readiness is evidenced by outcomes, not the number of commits.'])
add(82,'8C','Build and qualify the exact release candidate',list(range(1,82)),'R16','F01 F30 F32',
 'verification/research-program/release/ docs/research-program/release-runbook.md',
 'The final release artifact is reproducible, independently gated and ready for a concrete decision.',[
 'Capture the immutable candidate|Use the repository release-gate skill and dev-storage wrapper on the integrated head. Pin Node/lockfile/configuration and build once into retained artifacts.|Run required npm test, build, Cloudflare dry-run and declared release checks on the exact subject; skipped checks are not passes.',
 'Verify staging with retained bytes|Deploy only to the authorized staged target and run data/API/browser/crawler/client acceptance against the retained artifact. Verify hashes and source generation.|A rebuild creates a new candidate; old approvals and receipts cannot be copied onto changed bytes.',
 'Prepare the concrete release decision packet|Provide artifact identity, changes, remaining accepted limitations, costs, operational changes, smoke tests and exact rollback target. Resolve existing successor approvals for this subject.|The owner reviews a complete artifact/plan; no public traffic, paid resource or secret change occurs before its required authorization.'
 ],['The release evidence includes all R01–R16 statuses and independent reviewer identity.','A release-gate failure is repaired and requalified, not waived by regenerating a receipt.'])
add(83,'8C','Roll out the reviewed release and verify production',[82],'R16','F01',
 'verification/research-program/release/deployment.json docs/research-program/release-runbook.md',
 'The authorized production release serves the bytes and data that were reviewed.',[
 'Execute the approved staged rollout|Follow the exact release packet and current operational authorization, including zero-traffic/preview checks where available. Keep source and publication state pinned.|Read back the deployed version and configuration; no implicit upgrade, new binding or rebuilt bundle is introduced.',
 'Verify production research journeys|Check both public domains, source/schema manifests, key discovery tasks, actual MCP/WebMCP and website examples with bounded requests.|Record real responses and screenshots from production; staging evidence is not relabeled as production verification.',
 'Record deployment and rollback state|Write the exact deployment identity, traffic state, observed health, immediate rollback target and monitoring owner; update relevant host notes only when facts change.|Any material parity/data/availability failure triggers the agreed rollback and keeps the failed release evidence intact.'
 ],['No deployment takes place merely because this planning package exists.','Production truth matches the independently qualified artifact.'])
add(84,'8C','Verify sustained operation and publish the completion report',[83],'R01 R02 R03 R04 R05 R06 R07 R08 R09 R10 R11 R12 R13 R14 R15 R16','F07 F22 F30 F32',
 'verification/research-program/operations/ docs/research-program/COMPLETION.md',
 'The program closes only after the product stays useful and honest under actual refresh.',[
 'Collect the sustained-operation evidence|Observe at least fourteen days and two full scheduled cycles with source attempts, freshness, queue age, cost, review backlog and public health. Notify only meaningful changes.|Missing observation time or a failed cycle remains unverified; a scheduled automation being created is not evidence that it ran.',
 'Recheck the acceptance vector after refresh|Verify cohort readiness, source/schema changes, examples, machine parity and no silent data loss after real publication updates. Confirm actual budget and retention behavior.|A regression reopens the affected requirement and creates a bounded remediation task; an old passing receipt cannot cover changed data.',
 'Publish completion and continuing ownership|Astra signs the independent technical review; record owner release/scientific decisions and named ongoing responsibilities. Publish coverage limits and the current evidence report.|Declare completion only when every requirement has a current passing witness or an explicitly amended, reasoned acceptance decision; no hidden waived deficits.'
 ],['The final report describes demonstrated outcomes for humans and machines.','Continued source changes have an operating owner and a tested recovery path.'])


# Bounded implementation deficit discovered by CI run 34541539731.
add(85,'1A','Verify current CI work without transferring historical approval',[1],'R16','F01 F32',
 'scripts/verify-wp0-attestation.mjs scripts/run-contract-suites.mjs tests/wp0-attestation.test.mjs verification/research-program/ci-attestation/ docs/research-program/ci-attestations.md',
 'Current technical checks run on changed candidates while immutable historical approval remains bound to its original subject.',[
 'Define historical and current evidence boundaries|Add a read-only verifier and bounded policy that pins the existing WP0 v1.4 approval, evidence and approved receipt. Validate the stored approval against its original subject using existing successor helpers, then build fresh technical evidence and a pending draft for the current code. Preserve exact implementation inventory/hash coverage. Do not issue approval, overwrite a receipt, or label a historical approval as current.|The new replay-script addition yields a fresh passing technical draft with a different subject and current approval still pending. Altered historical approval/evidence/receipt bytes, failed current technical checks, and malformed subjects fail.',
 'Integrate the scoped CI verification path|Route only the reviewed WP0 v1.4 validation path through the new verifier in the existing contract runner, preserving its test execution and every other suite, version selection, error propagation and nonzero-test-count requirement. Keep direct successor validation and issuance strict and unchanged.|Exercise actual runner selection and execution. Current verification failure, missing history, future or unknown suite versions and nonzero child exits cannot be swallowed. The original npm test chain and existing WP0 tests still execute.',
 'Publish reproducible CI evidence and release boundaries|Document historical versus current evidence, exact candidate/source hashes, the failed CI run, the current pending subject and downstream release instructions. Run the focused tests, full npm test and applicable exact-candidate gate. PR-082 still resolves current-subject successor approval and independent release qualification; a green development CI result cannot satisfy that approval.|Independent review reproduces the stale-subject trigger and corrected current checks, observes preserved predecessor bytes and no issued approval, and verifies fresh CI on the combined candidate.'
 ],['No historical approval is silently repinned or widened.','A failed current check remains failed, and missing current-subject approval remains explicit for release qualification.'])
PLAN_EXTENSIONS=[dict(id='PR-085',parent_pr='PR-001',kind='bounded_ci_remediation',trigger='GitHub CI run 34541539731 on 487f06a756e3c23640dad08fc7f797643c8f186b',reason='A new verification replay script changes the repository-wide WP0 subject while all other technical evidence remains identical; each implementation change also needs a current technical check without historical approval transfer.')]
for pr in PRS:
    if pr['id']=='PR-082':pr['dependencies'].append('PR-085')


# PR-085 full test replay exposed a second immutable subject and the already
# authorized PR-003 root test-chain transition. Keep the assignment bounded to
# these two exact versioned CI paths; no approval is transferred or issued.
for pr in PRS:
    if pr['id'] != 'PR-085':
        continue
    pr['files'].extend([
        'scripts/verify-ci-attestation.mjs',
        'verification/testing/ci/v1.4.0/',
        'tests/ci-attestation.test.mjs',
        'package-lock.json',
    ])
    pr['commits'][0]['instructions'] += ' The full PR-085 replay also exposes a changed CI v1.3 subject from the runner bytes. Pin the complete historical CI v1.3 approval/evidence/receipt and predecessor chain without editing any existing CI version. Add a versioned CI v1.4 structural inventory and a read-only current verifier, reusing workspace-lock/discovery and successor helpers. The new inventory must support the two explicitly reviewed root test sequences: the original sequence, and that sequence with PR-003 test:research-program after test:worker. When test:research-program is declared it must be registered exactly and executed exactly once. Retain every legacy gate, exactly one navigator aggregate, all workflow/lock/child-output/offline invariants and actual input byte hashes. Do not normalize current input bytes into historical ones.'
    pr['commits'][0]['verification'] += ' Independently reproduce CI v1.3 runner-hash drift and its rejection of the PR-003 test sequence. Historical CI proof tampering, absent predecessor evidence, malformed current evidence and changes outside either reviewed test sequence fail. Current CI v1.4 evidence remains an unapproved draft and explicitly distinguishes structural inventory from actual suite execution.'
    pr['commits'][1]['instructions'] += ' Extend the scoped runner path only to the explicitly introduced ci-verification v1.4.0 package and its exact validate command; retain WP0 v1.4.0 routing. CI version discovery selects v1.4 by the existing highest-version rule. Preserve all four prior CI integration test behaviors as meaningful updated v1.4 tests, the historical v1.3 package byte-for-byte, and its strict direct validation. Keep new CI direct successor --validate/--issue approval requirements strict; only the reviewed development aggregate uses the read-only verifier. Future/unknown versions retain their normal strict execution. Update only the npm 11.19.1 lock entries needed for the new local workspace package; do not change root package.json or unrelated dependency resolutions.'
    pr['commits'][1]['verification'] += ' Exercise real subprocess routing and error propagation for CI v1.4, future CI versions, failing current evidence and zero-test children. Both reviewed root chains retain their actual registered tests; deleted/reordered legacy gates and duplicate/missing aggregate invocation fail. Lock consistency must cover the newly discovered workspace.'
    pr['commits'][2]['instructions'] += ' Retain the full npm-test failure from PR-085 command cmd-0014-9cb38845 and the independently captured CI diagnosis. Report both WP0 and CI current subject identities as pending authorized review. PR-082 must resolve both current-subject approvals and independently qualify the exact release candidate. Additive correction commits are recorded as executed corrections; the initial 84-PR/252-commit baseline and the 85-PR/255-planned-commit model remain unchanged.'
    pr['commits'][2]['verification'] += ' Final combined PR-003/PR-085 npm test, build, CF dry-run and hosted CI must pass; a producer-only WP0 replay cannot satisfy this condition. No approval may be issued or repinned as a side effect of tests.'
PLAN_EXTENSIONS[0]['reason'] += ' The PR-085 full test run also proves that CI v1.3 seals the changed runner, and its historical structural inventory rejects the accepted PR-003 test-chain extension. The same bounded assignment adds versioned current CI evidence while retaining both historical proof sets.'
PLAN_EXTENSIONS[0]['followup_trigger'] = {'candidate_head': '7cfbb96096d5eba46c37fb5b1885f116aa82ab80', 'command_id': 'cmd-0014-9cb38845', 'diagnostic_sha256': 'cb8c54e0d432e3353ed65159a2232030e93124c2c5b5f439a46ee5d93375a80d'}


# The independently reproduced next full-test blocker is WP11 v1.3.0's
# immutable approval subject. This exact additional adapter remains bounded;
# no other selected package/version receives an approval fallback.
for pr in PRS:
    if pr['id'] != 'PR-085':
        continue
    pr['files'].extend([
        'scripts/verify-wp11-attestation.mjs',
        'tests/wp11-attestation.test.mjs',
        'verification/research-program/ci-attestation/wp11-v1.3.0/',
    ])
    pr['commits'][0]['instructions'] += ' A later full npm-test run and independent replay expose WP11 v1.3.0 SUCCESSOR_APPROVAL_STALE_SUBJECT: the current builder passes but the additive CI workspace lock changes its subject. Add one versioned read-only WP11 current-attestation adapter for that exact existing package. Pin its historical approval, evidence, approved receipt and required predecessor receipts byte-for-byte; validate the historical approval against its original recomputed subject. Invoke the existing current WP11 technical builder and validator without editing them; retain all current file hashes, disabled-feature and pending-authorization fields. Bind the adapter, policy, runner and focused-test bytes in the current attestation evidence; distinguish the existing strict WP11 technical-draft subject from any explicitly versioned wrapper subject. No current claim or file pin may be replaced with an approved historical value. Do not add a workspace, change the root manifest/lock or modify any historical WP11 version, successor helper, approval or receipt.'
    pr['commits'][0]['verification'] += ' Independently reproduce the exact WP11 stale-subject failure and the passing unapproved current draft. Positive controls cover the actual PR085 lock and prospective PR003 root manifest. Missing or tampered historical proof/predecessors, malformed or failed current evidence, mismatched implementation hashes and any current approval/release overclaim must fail. Historical proof and current file coverage must be complete, and unchanged historical bytes remain explicitly distinguished from newly observed current evidence.'
    pr['commits'][1]['instructions'] += ' Extend aggregate routing only to alias wp11, path verification/wp11/v1.3.0, version 1.3.0, the exact package identity and existing node tools/verify.mjs --validate command. Continue running its real four-test suite; every other script, suite and future/unknown WP11 version follows its original strict execution. The read-only adapter accepts no approval/issue option and writes no approval artifacts. Preserve existing WP0/CI/WP14 paths and failure, timeout, output-bound and nonzero-test-count behavior. No generic approval exception or replacement of the root test chain is permitted.'
    pr['commits'][1]['verification'] += ' Exercise real subprocess routing with exact WP11 identity and rejection for a future version, wrong package, altered validate command and nonmatching path. A nonzero, signaled or timed-out child and zero-test suite must remain failures; retained artifact hashes must prove no approval/evidence mutation. The existing WP11 tests and both original/PR003 root sequences still execute their registered checks.'
    pr['commits'][2]['instructions'] += ' Retain the WP11 full-run failure cmd-0022-aa4a557b and independent diagnosis, and record the complete selected-package input audit before another full gate. If that audit establishes a different current failure needing source changes, split or review its bounded scope before implementing it; this amendment authorizes only the named WP11 adapter. Correct PR085 package.json provenance by retaining the exact original Git-snapshot source identity and separately naming the reviewed PR003 transition input; do not relabel the producer snapshot as the combined manifest. Preserve earlier command receipts/index snapshots. Publish the newly checked exact head and its pending current subjects. PR082 must resolve WP11 current-subject approval alongside WP0 and CI and independently qualify the exact candidate.'
    pr['commits'][2]['verification'] += ' The exact combined PR003/PR004/PR085 candidate must pass all selected suites, npm test/build/CF dry-run and hosted CI, with current handoffs validated in their explicit immutable/current contexts. No producer-only result, simulated overlay or old full-gate receipt qualifies the combined candidate. Freeze all R01-R16 definitions and cohorts unchanged.'
PLAN_EXTENSIONS[0]['reason'] += ' A later retained full npm-test failure and independent replay establish WP11 v1.3 stale approval from the additive CI lock. The same exact-package current-evidence boundary is extended only to WP11 v1.3 while all historical proofs and strict direct validation remain immutable.'
PLAN_EXTENSIONS[0]['wp11_followup_trigger'] = {'candidate_head': '4f90157108a92ce9541c340d5536eac31f24a1d8', 'retained_full_command_id': 'cmd-0022-aa4a557b', 'independent_diagnostic_sha256': 'b2600e7dc71460b0043f869d9f6fae35dc9c9496936c715c11b197780b9605b8'}


# Independently observed PR007 package-seal mismatch: authorize only current
# package accounting metadata, preserving frozen contracts and review boundaries.
for pr in PRS:
    if pr['id'] == 'PR-007':
        pr['commits'][2]['instructions'] += ' Refresh the current identity package manifest and validation receipt from actual package bytes after the reviewed source/schema changes. Preserve all frozen contract dependency pins, disabled candidate-only resolution boundaries and external-review counters; do not issue scientific approval or modify historical successor artifacts.'
        pr['commits'][2]['verification'] += ' Run the existing identity package tests and npm run validate --prefix packages/identity. Retain the original 25-versus-30 file-count failure; a current package seal must match its actual payload and cannot waive contract or scientific requirements.'


# New bounded scope, independently reviewed before implementation.
PRS.append({'id': 'PR-086',
 'phase': 'P1',
 'subphase': '1A',
 'title': 'Separate original WP11 input proof from current verification',
 'dependencies': ['PR-003', 'PR-085'],
 'requirements': ['R16'],
 'findings': ['F01', 'F32'],
 'files': ['scripts/verify-wp11-attestation.mjs',
           'tests/wp11-attestation.test.mjs',
           'verification/research-program/ci-attestation/wp11-v1.3.0/',
           'docs/research-program/ci-attestations.md'],
 'outcome': 'Historical WP11 approval remains bound to its exact original inputs while actual current inputs '
            'receive separate, unapproved technical checks.',
 'commits': [{'id': 'C-086-1',
              'subject': 'Retain and verify original WP11 input bytes',
              'instructions': 'Retain all 154 actual historical preimages from commit '
                              '30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0 in a portable content-addressed '
                              'snapshot outside verification/wp11/v1.3.0. Match exact path, length and '
                              'SHA-256 against the immutable approved receipt '
                              'e596e1b18a0251f611990c9752e1d12fb36cd05dab16bf55cf96e8d1fc431f9d, subject '
                              '294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98. Add a '
                              'bounded snapshot reader under the owned current-attestation directory and use '
                              'it for historical input proof. Preserve the historical package, approvals, '
                              'evidence, receipts and predecessor chain byte-for-byte. Historical validation '
                              'must work without Git/network and cannot substitute current or synthetic '
                              'bytes. Keep the existing historical-pins and current-replay records as '
                              'prior-candidate evidence; new records are additive and clearly identified.',
              'verification': 'Recover and verify 154 files totaling 1,347,732 bytes against the sealed '
                              'inventory. Test missing, extra, one-byte-tampered and current-substituted '
                              'blobs, incomplete inventories, duplicate paths and invalid path references. '
                              'Prove verification from retained bytes with Git unavailable and unchanged '
                              'historical subject. Rejected bytes cannot yield a passing historical proof.'},
             {'id': 'C-086-2',
              'subject': 'Bind current WP11 checks without transferring approval',
              'instructions': 'Keep the existing WP11 v1.3.0 technical builder, validator, successor helper '
                              'and general runner unchanged. Invoke the actual builder on current source '
                              'bytes and validate its complete current inventory. Separately bind adapter, '
                              'tests, policy, unchanged runner, snapshot and snapshot reader into an '
                              'explicit current wrapper subject. Preserve distinct technical and wrapper '
                              'package identities and approval=null on both. Emit every '
                              'historical-versus-current changed input with both hashes, sizes and source '
                              'roles; no first-failure-only report or silent allowlist of the 11 PR005 '
                              'files. Preserve all current technical/disabled-feature checks, strict direct '
                              '--validate/--issue, exact aggregate routing, actual suite execution, '
                              'future-version behavior, nonzero-test requirement, error, signal, timeout and '
                              'output-bound propagation. Do not merge product inputs into a wrapper that '
                              'substitutes for the existing technical subject or rebuild historical evidence '
                              'from mixed current/snapshot reads. Record the existing builder coverage '
                              'limits explicitly without expanding historical package scope or implying full '
                              'release qualification.',
              'verification': 'An actual current-file change changes its pending technical subject while '
                              'original snapshot proof still passes. Missing snapshot/reader bindings, stale '
                              'policy pins, failed/malformed current evidence and any approval/release '
                              'overclaim fail. A PR005-941c9cd comparison reports all 13 changed inputs (11 '
                              'new plus two package transitions); the pre-PR005 integration comparison '
                              'reports two. Preserve existing real runner, future-version, zero-test, '
                              'timeout and child-error tests; strict direct validation and issuance still '
                              'reject historical approval on the current subject.'},
             {'id': 'C-086-3',
              'subject': 'Publish current-input evidence and combined acceptance boundary',
              'instructions': 'Retain sanitized complete commands, snapshot provenance, all original failed '
                              'receipts, fresh candidate-specific replays and an evidence index. Explain '
                              'historical approval, current technical draft, wrapper draft and their '
                              'separate identities in the current-attestation documentation and PR086 '
                              'handoff. Bind exact integration/dependency/source hashes; a typed pending '
                              'final head avoids self-reference. PR005 functional work produced under its '
                              'earlier dependency packet remains historical producer evidence and can '
                              'integrate only after the combined PR005/PR086 candidate passes independent '
                              'checks. PR082 consumes this assignment and still resolves current-subject '
                              'approval and exact release qualification. No historical approval is widened, '
                              'no current approval is issued and no deployment is performed.',
              'verification': 'Run the focused WP11 attestation tests, actual selected WP11 aggregate, '
                              'current adapter and handoff validation. The controller independently inspects '
                              'original byte hashes, decisive negative cases and the final immutable head, '
                              'then runs the applicable full gate and hosted CI on the combined candidate. '
                              'Producer-only success, synthetic overlays and old gate receipts do not '
                              'qualify the combined result; R01-R16 definitions and frozen cohorts remain '
                              'unchanged.'}],
 'acceptance': ['Complete original WP11 byte proof remains immutable and independently reproducible offline.',
                'Every current difference is inspectable and current technical/wrapper subjects remain '
                'explicitly unapproved.',
                'PR005/PR086 combined tests and the exact candidate gate pass without changing strict '
                'successor approval or current scientific boundaries.']})
PLAN_EXTENSIONS.append({'id': 'PR-086',
 'parent_pr': 'PR-005',
 'kind': 'bounded_wp11_current_input_remediation',
 'trigger': 'Independent review of PR005 head 941c9cd and GitHub CI run 34610410659 prove 11 changed WP11 '
            'inputs beyond the two historical package transitions.',
 'reason': 'Retain all 154 original sealed input preimages portably and verify current bytes in a separate '
           'pending technical subject, preserving historical approval and every current execution gate.',
 'independent_design_review_sha256': '15aa02045e670ad67ba087114292328e1d034be3e8f2d8265eaec8a47a09fc39',
 'controller_preimage_audit': 'verification/research-program/bootstrap/wp11-plan-and-pr007-r2-review-20260911/wp11-historical-preimages-controller-audit.json'})
for pr in PRS:
    if pr["id"] in ["PR-005", "PR-082"]:
        pr["dependencies"].append("PR-086")
    if pr["id"] == "PR-005":
        pr["acceptance"].append("The separately reviewed PR086 current-input correction must be integrated and the combined PR005/PR086 exact candidate must pass required checks before PR005 integration acceptance. Earlier producer work retains its original dependency/plan provenance.")
