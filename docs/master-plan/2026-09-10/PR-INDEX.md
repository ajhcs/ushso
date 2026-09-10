# PR index

Generated from `plan-source.py` by `build.py`. The source, index and PR packets describe planned work; none is a claimed implementation.

Use [the execution protocol](EXECUTION.md) with every packet. A PR is ready when its listed dependencies have merged and its required external facts/permissions exist. Phase numbers describe capabilities; they are not a forced serial schedule. PR-042 deliberately consumes completed P5 intake because the core cohort includes those sources.

## P1 — Establish source truth

One baseline, accurate evidence states and versioned source identities.

### 1A — Baseline and acceptance

Exact baseline plus fixed success criteria and review protocol.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-001: Reconcile the deployed release and integration base](prs/PR-001.md) | One exact integration base and a preserved map of old work to this program. | None |
| [PR-002: Freeze research cohorts and acceptance denominators](prs/PR-002.md) | A stable catalog denominator, 100-product core cohort, missing-source set and MRF pilot selection. | PR-001 |
| [PR-003: Make implementer handoffs and review evidence enforceable](prs/PR-003.md) | Every implementer PR arrives with enough evidence for independent review. | PR-001, PR-002 |
| [PR-085: Verify current CI work without transferring historical approval](prs/PR-085.md) | Current technical checks run on changed candidates while immutable historical approval remains bound to its original subject. | PR-001 |

### 1B — Truth repairs

Accurate field states, freshness, inference labels and catalog dispositions.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-004: Introduce field-level completeness and evidence states](prs/PR-004.md) | Completeness measures facts, applicability and test attempts separately. | PR-002 |
| [PR-005: Correct freshness and inferred-unit evidence labels](prs/PR-005.md) | The live clock and scientific evidence labels agree across cards, detail and APIs. | PR-004 |
| [PR-006: Account for isolated records and unusable facets](prs/PR-006.md) | Source defects are visible without making missing values useful filters. | PR-004, PR-005 |

### 1C — Versioned source model

Bound product/release/distribution/field identities and storage rules.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-007: Bind products to releases and distributions](prs/PR-007.md) | Source-native identities can supply actual context IDs to clients. | PR-004 |
| [PR-008: Separate wire fields from labels and scientific meaning](prs/PR-008.md) | Dictionary information can coexist with exact API keys without false schema claims. | PR-007 |
| [PR-009: Set evidence storage and verification operating bounds](prs/PR-009.md) | Collection, sample retention and infrastructure decisions are explicit and cost bounded. | PR-003, PR-004, PR-007, PR-008 |

Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.

## P2 — Programmatic evidence

Every baseline record has an evidenced processing disposition.

### 2A — Durable collection

Resumable jobs with bounded transport, quotas and useful failures.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-010: Connect durable collection jobs to existing ingestion ports](prs/PR-010.md) | Bounded collection jobs resume safely and have durable outcomes. | PR-009 |
| [PR-011: Validate HTTP content and source access outcomes](prs/PR-011.md) | Normal source failures are correctly typed and do not contaminate metadata. | PR-009, PR-010 |
| [PR-012: Enforce source quotas, retries and resumable scheduling](prs/PR-012.md) | Thousands of checks respect publisher limits and survive retries. | PR-010, PR-011 |

### 2B — Source adapters

Evidence-backed CMS, CDC and Census metadata extraction.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-013: Extract CMS distribution and resource metadata](prs/PR-013.md) | All 159 baseline CMS entries expose evidence-backed distribution/resource candidates. | PR-007, PR-008, PR-011, PR-012 |
| [PR-014: Bind CDC view metadata and columns](prs/PR-014.md) | CDC view, column and documentation identities are consistently linked. | PR-007, PR-008, PR-011, PR-012 |
| [PR-015: Support Census metadata and keyed sample requests](prs/PR-015.md) | Census product/vintage/geography metadata and key requirements are explicit. | PR-007, PR-008, PR-011, PR-012 |

### 2C — Documents and keys

Parser coverage, exact wire-name mappings and literal field meanings.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-016: Route difficult documentation to resumable parsers](prs/PR-016.md) | Existing document parsers cover known document families with explicit residual queues. | PR-013, PR-014, PR-015 |
| [PR-017: Reconcile dictionary names with observed wire keys](prs/PR-017.md) | Generated recipes use actual field names and reviewed aliases. | PR-008, PR-013, PR-016 |
| [PR-018: Extract definitions, code values and unit applicability](prs/PR-018.md) | Literal scientific documentation improves fields without invented semantics. | PR-008, PR-014, PR-015, PR-016 |

### 2D — Samples and full inventory

Bounded tested examples plus complete baseline attempt accounting.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-019: Build a bounded API and file example tester](prs/PR-019.md) | Each recipe can prove exactly what a small real request checked. | PR-009, PR-011, PR-013, PR-014, PR-015, PR-017 |
| [PR-020: Schedule a complete baseline eligibility and attempt sweep](prs/PR-020.md) | Every baseline record receives a bounded processing disposition. | PR-012, PR-013, PR-014, PR-015, PR-016, PR-019 |
| [PR-021: Close deterministic extraction deficits and publish the baseline](prs/PR-021.md) | Deterministic results have a measured acceptance boundary and an explicit residual workload. | PR-018, PR-020 |

Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.

## P3 — Residual AI and publication

Evaluated low-cost proposals become accepted, reproducible metadata.

### 3A — Provider and cost controls

Exact model routing, eligible inputs and atomic spend controls.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-022: Add a product-owned OpenRouter extraction adapter](prs/PR-022.md) | Residual extraction can call an exact provider/model through a small typed interface. | PR-009, PR-021 |
| [PR-023: Control provider data policy and evaluated fallbacks](prs/PR-023.md) | Only approved public evidence reaches an explicitly selected model endpoint. | PR-022 |
| [PR-024: Enforce inference budgets, deduplication and usage accounting](prs/PR-024.md) | Concurrent enrichment jobs cannot silently exceed the selected spend cap. | PR-012, PR-022, PR-023 |

### 3B — Extraction and evaluation

Bounded evidence tasks and independently evaluated claim proposals.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-025: Build bounded residual evidence tasks](prs/PR-025.md) | Models receive only the specific evidence needed for a named unresolved field. | PR-018, PR-021, PR-024 |
| [PR-026: Validate evidence-cited model extraction](prs/PR-026.md) | Model output becomes a traceable proposal with explicit uncertainty. | PR-025 |
| [PR-027: Evaluate DeepSeek and Muse on held-out extraction tasks](prs/PR-027.md) | Model choice is based on correct accepted claims and review cost. | PR-002, PR-024, PR-026 |

### 3C — Review and publication

Exact claim decisions and coherent reversible public generations.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-028: Create a review queue for exact claims and conflicts](prs/PR-028.md) | Reviewers see a proposed value, its source and its precise downstream effect. | PR-026, PR-027 |
| [PR-029: Promote qualified metadata under explicit rules](prs/PR-029.md) | Supported literal metadata can scale while high-impact uncertainty remains reviewable. | PR-004, PR-007, PR-008, PR-028 |
| [PR-030: Publish coherent metadata generations](prs/PR-030.md) | UI, search, dictionaries and machine tools consume the same accepted generation. | PR-007, PR-021, PR-029 |

Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.

## P4 — Research usefulness

Scientific semantics, linkage and retrieval support complete research tasks. Full core qualification consumes P5 intake.

### 4A — Scientific semantics

Grain, dates, measurements and useful evidence-backed source cards.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-031: Model observation grain and temporal applicability](prs/PR-031.md) | A source card distinguishes what one row represents from release and reporting dates. | PR-007, PR-008, PR-029 |
| [PR-032: Represent measures, denominators and uncertainty](prs/PR-032.md) | Researchers can distinguish comparable measurements from superficially similar fields. | PR-018, PR-029, PR-031 |
| [PR-033: Generate useful source cards from accepted facts](prs/PR-033.md) | Source pages answer practical research questions with concise, supported facts. | PR-030, PR-031, PR-032 |

### 4B — Linkage

Typed identifiers, authoritative crosswalks and qualified join routes.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-034: Preserve identifier systems and key constraints](prs/PR-034.md) | Keys are typed by identifier system, entity and validity period. | PR-007, PR-008, PR-031 |
| [PR-035: Ingest authoritative crosswalks and mapping evidence](prs/PR-035.md) | Cross-source linkage candidates have authoritative mapping and version context. | PR-012, PR-019, PR-034 |
| [PR-036: Validate and publish priority join routes](prs/PR-036.md) | At least fifteen intended joins have inspectable compatibility evidence. | PR-032, PR-035 |

### 4C — Retrieval

Named-source/family resolution, scientific relevance and current evaluation.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-037: Resolve named sources and release families](prs/PR-037.md) | Exact named-source requests distinguish the product family from related catalog text. | PR-007, PR-030 |
| [PR-038: Correct research relevance and exclusion behavior](prs/PR-038.md) | Search respects important scientific distinctions and explicit user constraints. | PR-031, PR-032, PR-037 |
| [PR-039: Publish a current-generation retrieval evaluation](prs/PR-039.md) | The current product has a reproducible relevance and coverage report. | PR-002, PR-030, PR-036, PR-038 |

### 4D — Priority-cohort workflows

Core readiness, reproducible examples and scientific qualification after expansion.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-040: Track core-cohort research readiness by product](prs/PR-040.md) | Every priority product has a measured route from source evidence to use. | PR-002, PR-021, PR-030, PR-033 |
| [PR-041: Build reproducible research example packets](prs/PR-041.md) | Users can reproduce a source selection and its technical next steps. | PR-033, PR-036, PR-040 |
| [PR-042: Qualify scientific completeness of the priority cohort](prs/PR-042.md) | Core research usefulness is independently assessed, with deficits blocking acceptance. | PR-032, PR-039, PR-040, PR-041, PR-043, PR-044, PR-045, PR-054 |

Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.

## P5 — Coverage and MRFs

Missing source families and hospital/payer price files have usable routes.

### 5A — Missing source families

Twelve priority families with documented product and access scope.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-043: Add missing federal source-family routes](prs/PR-043.md) | HRSA AHRF, NPPES, SAMHSA, T-MSIS/TAF and SVI have supported product identities and access routes. | PR-013, PR-014, PR-015, PR-030, PR-037 |
| [PR-044: Add state finance, APCD and facility-source routes](prs/PR-044.md) | PHC4, APCD, facility licensure and closure tracking are represented with explicit state scope. | PR-012, PR-030, PR-037 |
| [PR-045: Document HCUP, MEPS and AHA access workflows](prs/PR-045.md) | Restricted, paid and public products have useful next steps without false access claims. | PR-023, PR-030, PR-033, PR-037 |

### 5B — Hospital MRFs

Hospital locators plus bounded versioned JSON and CSV parsing.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-046: Discover hospital MRF locators and schema versions](prs/PR-046.md) | The selected 25 hospitals have an auditable MRF locator/disposition. | PR-002, PR-009, PR-011, PR-012, PR-034 |
| [PR-047: Parse bounded hospital JSON MRF samples](prs/PR-047.md) | Hospital JSON samples expose versioned item, charge and payer fields. | PR-008, PR-019, PR-046 |
| [PR-048: Parse hospital CSV MRF formats](prs/PR-048.md) | Supported hospital wide/tall CSV files share the JSON metadata contract. | PR-008, PR-019, PR-046, PR-047 |

### 5C — Payer MRFs

Payer indexes, rate samples and provider-reference context.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-049: Parse payer Transparency in Coverage indexes](prs/PR-049.md) | Ten payer reporting entities have scoped plan/file inventories. | PR-002, PR-009, PR-011, PR-012, PR-034 |
| [PR-050: Parse bounded payer in-network rate samples](prs/PR-050.md) | Payer samples preserve rate, code and provider-reference context. | PR-008, PR-019, PR-049 |
| [PR-051: Resolve payer provider references without identity shortcuts](prs/PR-051.md) | Rate samples can identify the declared provider groups within the same file context. | PR-034, PR-049, PR-050 |

### 5D — Pricing product

Price semantics, discoverable profiles and qualified research examples.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-052: Validate price dimensions and sample quality](prs/PR-052.md) | Price previews state their scope and block invalid comparisons. | PR-032, PR-047, PR-048, PR-050, PR-051 |
| [PR-053: Publish hospital and payer MRF directory profiles](prs/PR-053.md) | MRFs become discoverable products with useful sample and access metadata. | PR-030, PR-046, PR-049, PR-052 |
| [PR-054: Qualify the MRF pilot and author pricing research examples](prs/PR-054.md) | MRF discovery has demonstrated research tasks and an honest pilot coverage report. | PR-041, PR-043, PR-044, PR-045, PR-053 |

Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.

## P6 — Machine product

All enabled tools have real positive research paths and honest limitations.

### 6A — Source and dictionary APIs

Actual contexts, routes and variables on enabled machine operations.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-055: Return real release and distribution collections](prs/PR-055.md) | get_asset gives clients the actual context required for follow-up calls. | PR-007, PR-030, PR-033, PR-053 |
| [PR-056: Serve actionable access plans and retrieval recipes](prs/PR-056.md) | The access/recipe tools can describe tested public and verified manual routes. | PR-019, PR-033, PR-045, PR-055 |
| [PR-057: Expose qualified variables and proposal status coherently](prs/PR-057.md) | get_variables serves exact contextual fields; proposals remain separately inspectable. | PR-008, PR-029, PR-055 |

### 6B — Client contracts

Consistent schemas, useful recovery and clean MCP installation.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-058: Publish a self-consistent machine contract bundle](prs/PR-058.md) | Public contract files and examples actually describe deployed operations. | PR-055, PR-056, PR-057 |
| [PR-059: Harden ordinary client pagination and recovery behavior](prs/PR-059.md) | Clients recover from expected source/generation limits without guessing. | PR-055, PR-056, PR-057, PR-058 |
| [PR-060: Make the MCP plugin install and setup reproducible](prs/PR-060.md) | A new developer or agent can install the actual eight-tool client. | PR-058, PR-059 |

### 6C — Research packet and qualification

Comparison/planning and actual cross-transport acceptance.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-061: Expose research comparison and evidence packet APIs](prs/PR-061.md) | Agents can compare source suitability and export a reproducible metadata packet. | PR-036, PR-041, PR-055, PR-056, PR-057 |
| [PR-062: Qualify a bounded research-plan compilation workflow](prs/PR-062.md) | The disabled planner has a concrete path to useful, evidence-bound enablement. | PR-002, PR-041, PR-042, PR-054, PR-061 |
| [PR-063: Independently verify HTTP, MCP and WebMCP parity](prs/PR-063.md) | All enabled machine features have actual cross-transport evidence. | PR-058, PR-059, PR-060, PR-061, PR-062 |

Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.

## P7 — Human product

Beginners and experts can understand, compare, use and cite sources.

### 7A — Navigation and source detail

Plain-language discovery and useful source/variable pages.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-064: Create clear beginner, researcher and developer navigation](prs/PR-064.md) | People can understand the product and choose an appropriate starting route. | PR-005, PR-033, PR-041 |
| [PR-065: Make search results concise and decision-oriented](prs/PR-065.md) | Researchers see useful matches and meaningful filters without repeated technical boilerplate. | PR-006, PR-033, PR-038, PR-040, PR-064 |
| [PR-066: Build a useful source detail and preview page](prs/PR-066.md) | A source page answers what it contains, how to use it and what has actually been tested. | PR-033, PR-040, PR-055, PR-056, PR-057, PR-064 |

### 7B — Research workflow

Shortlist, comparisons and reproducible citation/evidence exports.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-067: Add a local research shortlist](prs/PR-067.md) | Users can retain selected sources without needing an account. | PR-041, PR-064, PR-066 |
| [PR-068: Add human source comparison and research workflow](prs/PR-068.md) | Humans can compare selected sources and assemble a supported research workflow. | PR-061, PR-062, PR-066, PR-067 |
| [PR-069: Export citations and reproducible research packets](prs/PR-069.md) | Source selections can be cited and handed to another researcher or agent. | PR-041, PR-061, PR-067, PR-068 |

### 7C — Guides and accountability

Beginner/expert/developer teaching and truthful public disclosures.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-070: Write beginner learning and API quick-start guides](prs/PR-070.md) | Beginner users and new developers have complete, tested starting instructions. | PR-041, PR-054, PR-060, PR-064, PR-066 |
| [PR-071: Write advanced research and MRF methods guides](prs/PR-071.md) | Advanced users can assess variable meaning, linkage and pricing limitations. | PR-031, PR-032, PR-036, PR-039, PR-054, PR-069, PR-070 |
| [PR-072: Complete About, accountability and correction guidance](prs/PR-072.md) | USHSO explains its mission, operator and editorial responsibilities plainly. | PR-064, PR-069, PR-070, PR-071 |

### 7D — Frontend qualification

Accessible, responsive and independently reviewed final product.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-073: Verify keyboard and assistive-technology workflows](prs/PR-073.md) | Core research tasks are accessible with documented tested limits. | PR-065, PR-066, PR-067, PR-068, PR-069, PR-070, PR-071, PR-072 |
| [PR-074: Verify mobile, browsers and discoverable source pages](prs/PR-074.md) | Source pages work across viewports and expose useful content to crawlers. | PR-058, PR-065, PR-066, PR-069, PR-073 |
| [PR-075: Apply Astra final frontend and content review](prs/PR-075.md) | The complete site reads clearly and presents real research content with consistent visual quality. | PR-064, PR-065, PR-066, PR-067, PR-068, PR-069, PR-070, PR-071, PR-072, PR-073, PR-074 |

Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.

## P8 — Operate and qualify

The exact reviewed product operates sustainably and is independently accepted.

### 8A — Refresh and capacity

Operating schedules, measured costs and tested recovery.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-076: Operate refresh schedules and actionable monitoring](prs/PR-076.md) | Freshness and data-quality changes are maintained by an observable bounded process. | PR-012, PR-024, PR-030, PR-053 |
| [PR-077: Measure indexing, delivery capacity and operating cost](prs/PR-077.md) | Runtime and storage choices are justified by current-cardinality measurements. | PR-024, PR-030, PR-053, PR-063, PR-074, PR-076 |
| [PR-078: Verify recovery, retention and production configuration](prs/PR-078.md) | The system can recover without losing evidence or silently changing public truth. | PR-009, PR-030, PR-059, PR-076, PR-077 |

### 8B — Independent acceptance

Data, human-use and evidence closure with no hidden deficits.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-079: Run independent whole-program data acceptance](prs/PR-079.md) | Astra has reproducible evidence that the data/API program meets its stated targets. | PR-021, PR-027, PR-039, PR-042, PR-054, PR-063, PR-077, PR-078 |
| [PR-080: Validate beginner and expert task completion](prs/PR-080.md) | Real intended users can use the product and interpret its limitations correctly. | PR-002, PR-041, PR-054, PR-063, PR-075 |
| [PR-081: Close acceptance gaps and assemble reviewer evidence](prs/PR-081.md) | A reviewer can determine whether the full product is ready without reading implementation chats. | PR-003, PR-072, PR-075, PR-079, PR-080 |

### 8C — Release and observation

Exact artifact qualification, authorized rollout and sustained verification.

| PR | Outcome | Dependencies |
|---|---|---|
| [PR-082: Build and qualify the exact release candidate](prs/PR-082.md) | The final release artifact is reproducible, independently gated and ready for a concrete decision. | PR-001 through PR-081 plus PR-085 (all required work before release) |
| [PR-083: Roll out the reviewed release and verify production](prs/PR-083.md) | The authorized production release serves the bytes and data that were reviewed. | PR-082 |
| [PR-084: Verify sustained operation and publish the completion report](prs/PR-084.md) | The program closes only after the product stays useful and honest under actual refresh. | PR-083 |

Sub-phase closure rule: every listed PR is merged, independently reviewed and its acceptance evidence exists; a sub-phase cannot close from implementation status alone.
