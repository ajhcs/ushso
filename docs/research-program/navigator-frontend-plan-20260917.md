# Navigator frontend enrichment plan — 2026-09-17

Task branch: codex/ushso-navigator-enrich-20260917 (isolated worktree; dirty workspace untouched).
Baseline: 20 questions / 20 profiles / 201 facts (8 indexed + 12 named gaps in baseline; 10 indexed + 10 gaps in candidate).
Assessment lineage: docs/research-program/navigator-integration-assessment-20260917.md.
Enrichment inventory: docs/research-program/documentation-enrichment-inventory-20260917.md (OP-DOC-ENRICH-20260917, no live HTTP in this task).
No production deployment, no network retrieval, no validator weakening. No source files fixed in this step — plan + failing-first tests only.

## 1. Current brief structure (as built)

Source: apps/web/src/components/PriorityResearchNavigator.tsx (143 lines) + apps/web/src/data/researchNavigator.ts (617 lines).
Styles: apps/web/src/styles.css priority-brief / priority-source / evidence-state rules (lines about 1259-1346).
Pages: apps/web/src/pages/LandingPage.tsx (PriorityResearchCatalog, 20 cards) + apps/web/src/pages/SearchResultsPage.tsx (PriorityResearchMatch above catalog results).

Render order today for one matched question (PriorityResearchBrief):

1. Header: eyebrow Research question, h2 Research brief, question text, packet download button with data-priority-packet.
2. Summary grid (.priority-brief__summary, 3-col desktop / 1-col mobile): Why this matches / Decision it supports / Next action (from question.matchExplanation, decision, nextAction).
3. Catalog scope note (.priority-brief__catalog): ACTIVE_CATALOG displayLabel + packet is metadata and routing evidence.
4. Evidence-state legend (details.evidence-state-legend): 6 badges.
5. Sources list (.priority-brief__sources): one PriorityResearchSource per question.sourceProfileIds (all 20 questions currently single-source). Each source:
   - header: familyId, h3 name, publisher and product, coverage badge (Indexed source record / Named source gap / Indexed documentation-first candidate).
   - coverageNote callout (.priority-source__note).
   - FactList: dl.priority-source__facts with 10 rows (indexed) or 10 rows plus extras (gaps). Labels: Publisher, Product, Population/entity, Geography, Period, Grain, Cadence, Variables/dictionary, Access/cost/account, IDs/joins (plus SVI Name collision conflicting row). Each dd shows value plus EvidenceStateBadge, plus nested details with summary Evidence references and small text record:ROC-ID#evidence:ID or registry:named-source-registry.v1.0.0:sourceId.
   - actions: Next action, Join limitation, conditional internal Link with data-navigator-details (only when catalogRecordId present), external Open official discovery route (officialDiscoveryUrl).

Data helpers: indexedProfile (10 facts, single record:catalogRecordId#evidenceId ref shared by all facts) and namedGapProfile (10 gap facts sharing registry ref plus optional candidate record ref in candidate mode). Packet (buildPriorityResearchPacket) deep-copies the same profile objects rendered in the brief, so brief-vs-packet is consistent by construction; brief/packet-vs-detail is NOT (detail derives live from catalogAdapter plus corpus record).

## 2. Target brief structure (6 sections + expandable provenance)

Enrichment lands first-party dictionary / variable / access data (inventory URLs); frontend then reshapes each source card into this fixed order. Section numbering is part of the contract so tests can assert order:

1. Useful for — one-sentence decision the source supports (source of truth: question.decision plus profile population). Replaces today Decision it supports box; keeps matchExplanation as Why this matches subline in brief header, not per-source.
2. Coverage (geo / period / pop / grain) — compact 4-line table from Geography/Period/Population/Grain facts with evidence badges inline. Unknown stays Not established with unknown badge; never infer.
3. Available info (representative vars + dictionary link) — up to 5 representative variable/field names plus one Open variable dictionary / codebook link (enrichment dictionaryUrl). Today Variables fact text is kept as fallback until enrichment lands; no full dictionary inline.
4. Access (concrete next step + restrictions) — per-source nextAction (concrete step) plus Access fact restrictions (cost/account/DUA/terms). Keeps Catalog membership is not payload access boundary.
5. Limits (few material ones) — at most 3 bullets: coverageNote (if gap/candidate) plus joinLimitations plus product-specific caveat (for example BRFSS no-nationwide, SVI name collision, provisional revision). Today full joinLimitations paragraph moves here, trimmed.
6. Evidence (readable publisher refs with resolvable links + precise locators) — one readable row per claim: publisher label plus short locator (for example CMS product page, CDC dossier section evidence e12c4273, Registry named-source-registry v1.0.0 section ahrq-hcup) each as an anchor with https href, plus precise locator (record_id plus evidence_id plus observed_at when retained). Technical IDs (record: plus registry: strings) move into details with summary Technical identifiers (expandable provenance). No opaque ID is the only reference.

Cross-cutting: brief header keeps question, Why-matches, packet download, catalog-scope note, legend (collapsed). Per-source card gets data-brief-section useful-for, coverage, available-info, access, limits, evidence in this order; technical IDs get data-provenance technical-ids.

## 3. Defects found (no fix in this step)

Conventions: Repro means offline steps, no live HTTP. Impact means researcher or validity risk. Repair means bounded proposal for the later integration step. All paths verified in this worktree.

### F-01 — Opaque, non-resolvable evidence references (broken/misleading links)
- Repro: render PriorityResearchBrief for hospital-finance-hcris (or any question) with renderToStaticMarkup; inspect FactList: details with summary Evidence references and small text record:obs:asset:...#evidence:... No anchor, no publisher label, no locator URL. Same in packet JSON (evidenceRefs arrays with record: and registry: strings).
- Impact: target section 6 unmet; researchers cannot resolve a claim to publisher or dossier; screen-reader users hear an opaque ID string.
- Repair (bounded): add resolveEvidenceLinks helper (pure, offline): record: refs become dataset details route plus evidence-dossier anchor (/datasets/:id#evidence-:evidenceId) plus publisher label from profile; registry: refs become named-source-registry section sourceId plus officialDiscoveryUrl. Render readable anchor list in section 6; keep raw IDs only inside data-provenance technical-ids details. No validator change; extend navigatorIntegration binding check to assert every rendered evidence link resolves (https or internal dossier anchor).

### F-02 — No dictionary / variable link (Available info gap)
- Repro: inspect Variables/dictionary fact for cms-hcris (Facility characteristics ... complete dictionary is not retained here) — no dictionary href. officialDiscoveryUrl is the generic product page, not a per-fact locator. Same for all 8 indexed profiles.
- Impact: target section 3 unmet; representative vars exist as prose, dictionary link missing.
- Repair: enrichment supplies per-profile dictionaryUrl plus representativeVars list (from inventory product/methodology/codebook navigation); render Open variable dictionary link in section 3 with up to 5 vars; fallback to current prose until enrichment lands. Bounded to researchNavigator profile inputs plus section-3 renderer.

### F-03 — Brief/packet vs detail divergence risk (contradictory facts)
- Repro (offline): compare hand-authored profile strings vs retained record description vs detail adapter output. Verified examples: BRFSS profile geography (participating jurisdictions; nationwide estimates are not available) mirrors record 5eh7-pjx8 description; SAHIE profile geography/period mirrors record sahie (single-year estimates for all counties, 2006-2024). Risk: profile text is a snapshot; detail page derives live via catalogAdapter (geographyDisplay, grainDisplay, timeDisplay) plus DatasetDetailsPage claim links. A corpus regeneration or adapter change can silently desync brief vs detail vs packet (packet snapshots brief at render time).
- Impact: contradictory facts across surfaces; hardest to notice for period/grain/cadence.
- Repair: extend the existing 3-profile cross-check in navigatorIntegration.test.ts (preserves product-specific scope) to all 8 indexed profiles: assert each profile Geography/Period/Grain/Cadence value quotes or accurately paraphrases the retained record description plus evidenceId binding (pattern already exists). No live fetch; keep test offline against records-000 jsonl files.

### F-04 — SVI wrong-product surface below the brief (misleading routing)
- Repro: search SVI question (svi-social-vulnerability). Brief correctly shows named gap plus conflicting Name collision fact citing record obs:asset:cdc-socrata:ypqf-r5qs with evidence 41cb563a. Verified offline: that record title is Social Vulnerability Index but description is COVID-19 vaccine-hesitancy estimates (HPS Week 26, ACS PUMS, PUMA-to-county crosswalk) — deliberate non-substitution is correct. But catalog results below the brief can still surface that same mis-titled record as a textual match without the brief warning context.
- Impact: researcher scrolling past brief may cite hesitancy estimates as SVI.
- Repair: keep non-substitution; add contextual guard: when a question has a conflicting fact, render its warning at top of section 5 Limits AND pass a name-collision flag the results list can surface (or move the colliding record into contextual separation). Bounded to navigator match plus results section; no ranking change.

### F-05 — Landing journey misroutes uninsured to PLACES (wrong-product routing)
- Repro: LandingPage journeys[1]: question County uninsured estimates without inventing Census coverage, source CDC PLACES county estimates, href /search?q=CDC PLACES county uninsured. Navigator uninsured route is SAHIE (county-uninsured), not PLACES (county-health-prevalence). PLACES brief does not claim uninsured; SAHIE record explicitly claims single-year estimates for all counties.
- Impact: landing-endorsed journey contradicts navigator routing; uninsured researcher sent to prevalence product.
- Repair: correct journey to SAHIE (Census SAHIE county uninsured estimates) or reword to prevalence mapping; keep href and query aligned with findPriorityResearchQuestion so landing href resolves to the intended brief. One-file copy fix plus test asserting each landing journey href resolves to its named source.

### F-06 — Query-overlap tie-break can pick prevalence over uninsured (wrong-product routing)
- Repro (offline, no HTTP): findPriorityResearchQuestion(CDC PLACES county uninsured) matches both county-uninsured (term county uninsured, len 16) and county-health-prevalence (term cdc places county, len 17). Longest-term-wins picks prevalence. Same class: behavioral-health appears in both BRFSS and SAMHSA term sets (currently disambiguated by longer behavioral health facilities vs behavioral health prevalence, but fragile).
- Impact: mixed-concept queries route to the wrong brief.
- Repair: bounded matcher hardening (no ranking change): prefer exact-question match (already first), then score by number of matched terms plus family coherence, not single longest substring; add regression cases for mixed queries (CDC PLACES county uninsured goes to SAHIE brief plus prevalence note, not PLACES brief). Keep unrelated-astronomy to null behavior.

### F-07 — Candidate membership shape mismatch (baseline/candidate error)
- Repro: navigator candidate mode in navigatorIntegration.test.ts: hrsa-workforce packet source coverage flips to indexed with catalogRecordId present, but facts remain gap-shaped (Geography/Period/Grain/Cadence/Variables all unknown, joinLimitations generic). Label says Indexed documentation-first candidate while fact table looks like a gap. Baseline correctly shows named_gap without recordId.
- Impact: indexed label overstates verification; validators expecting indexed profiles to carry documented dimensions will misread.
- Repair: keep mode derivation in catalogMode.ts (single source); introduce distinct candidate shape: coverage indexed stays, but section 2 Coverage explicitly states documentation-first: scope/period/grain/vars unverified, section 6 cites candidate record plus registry, detail page candidate-record panel already does this — mirror its wording in brief. Extend mode test to assert candidate-indexed profiles never carry successfully_tested or documented geo/period/grain (already asserts no successfully_tested; add unknown-coverage assertion).

### F-08 — Blanket ushso_observed and publisher_documented promotion (unsupported promotion)
- Repro: indexedProfile hardcodes Access/IDs to ushso_observed and Publisher/Product/Population to publisher_documented for all 8 indexed profiles, sharing one record ref. namedGapProfile marks Publisher/Product publisher_documented when documented:true (ahrq-hcup, meps, compendium, cms-nppes) else ushso_observed, based on registry presence — no live publisher fetch occurred (by design).
- Impact: observed/documented badges imply stronger verification than public catalog metadata observed; payload/terms not tested text supports.
- Repair: audit each promotion offline against retained evidence (record description plus evidence_id plus registry evidence_urls); demote to unknown where binding is only catalog visibility. At minimum, gate Access/IDs ushso_observed on explicit public catalog metadata observed evidence (already in text) and keep payload/terms as unknown or limit — document the rule in code comment so future enrichment promotes only with first-party dictionary/access evidence. No validator weakening: keep validatePriorityResearchNavigator requiring every fact bound to a ref plus valid state.

### F-09 — Uncovered per-fact promotions (unsupported promotion, partial test coverage)
- Repro: factStates overrides promote selected dims to publisher_documented or provisional (for example cdc-maternal Grain to documented, Period to provisional; census-sahie Geography/Period/Cadence to documented; cdc-places Geography/Period to documented). Integration test verifies only BRFSS geography, maternal cadence plus grain-negative, SAHIE geography. Unchecked: cms-hcris/chow/ltcf Period, cdc-places/maternal/infant remaining dims, brfss non-geo dims.
- Impact: silent promotion drift on the next edit.
- Repair: extend offline binding test to every factStates entry: assert the promoted value quotes or paraphrases the retained record description and the evidenceId exists in that record (pattern already exists). Keep defaults unknown.

### F-10 — Navigator return-focus plus assessment loss (focus defect)
- Repro: PriorityResearchSource builds returnId navigator-profile.id and navigates via navigate(detailsHref(scrollY)) WITHOUT searchAssessment state; SearchResultsPage.openDetails (catalog cards) passes searchAssessment. DatasetDetailsPage derives contextualQuestion by comparing selected_record_id to record_id — navigator-cms-hcris never equals obs:asset:..., so assessment block shows No matching search assessment, and back-destination anchor is #search-result-navigator-... (brief article) rather than a catalog card. Return-focus effect in SearchResultsPage runs only when discovery.status is ready; returning from a navigator detail while discovery is loading or error skips scroll plus focus restore.
- Impact: keyboard and screen-reader users lose place; assessment context dropped for navigator-originated details.
- Repair: pass searchAssessment (or explicit navigator-assessment) on navigator navigate; make return effect restore brief anchor plus focus [data-navigator-details] independent of discovery status (brief renders regardless); keep focus selector audit requiring both destinations plus focus call. Bounded to returnContext call sites plus effect guard.

### F-11 — Long briefs bury ordinary results (layout defect)
- Repro: search any navigator question (for example HCRIS). PriorityResearchMatch renders the full brief (summary plus legend plus 10-row dl plus actions) ABOVE .results-list. With legend plus facts expanded, brief height exceeds viewport and pushes Results in selected order far down. No collapse control. Mobile 390px does not overflow (grids collapse, packet button full-width — verified in prior assessment) but still pushes results down.
- Impact: ordinary catalog results hidden below a long routing card; mobile users scroll past 10 fact rows to reach matches.
- Repair (simplify, preserve auditability): render sections 1-5 as compact summary by default (Coverage 4-line table, Available info up to 5 vars, Limits up to 3 bullets, Evidence collapsed to readable link list); move full 10-row fact table plus technical IDs into Show all evidence-bound facts details. Keep packet download plus details links in header/actions so they stay above the fold. Add regression: brief default height and results-heading visibility assertion at 390px plus desktop.

### F-12 — Loading, error, download gaps (loading/error/download plus keyboard)
- Repro: (a) Loading: PriorityResearchMatch is synchronous (findPriorityResearchQuestion); while discovery.status is loading the brief appears instantly with no aria-busy or skeleton, then catalog results pop in below — layout shift. (b) Error: unknown sourceProfileIds makes buildPriorityResearchPacket throw (references an unknown source profile) with no error boundary; PriorityResearchSource returns null per missing profile, leaving a header plus empty sources. (c) Download: downloadJsonPacket creates object URL, clicks, revokes immediately — revocation can race the download in some browsers; no filename or size announcement, no no-Blob fallback. (d) Keyboard: fact and legend details are native (good), but evidence small text is non-focusable opaque IDs; packet button plus links are the only stops — evidence section needs real links (see F-01).
- Impact: confusion during load, blank or throw on bad data, flaky packet save, weak evidence keyboard path.
- Repair: (a) wrap brief in aria-busy tied to discovery status OR render brief after catalog scope note with a catalog loading line — no skeleton fetch, purely presentational. (b) Add route-level error boundary for brief and packet (Brief unavailable ... Revise search) plus keep validator throwing at build and test time. (c) Defer revokeObjectURL (requestAnimationFrame or timeout), announce filename via aria-live or title, keep contractVersion, filename, and mode assertions. (d) Evidence links as real anchors (F-01) preserve tab order; keep native details for provenance; no custom focus trap in brief.

## 4. Brief template (post-enrichment, per source)

Use indented structure below. Packet contract unchanged (ushso-priority-research-evidence-packet.v1.0.0, questionSetVersion priority-questions-v1.0.0, catalog block with mode, corpusVersion, generation, recordCount, evidenceMode published_offline_evidence). New enrichment fields (dictionaryUrl, representativeVars, evidenceLinks) are additive; validators extend, never weaken.

    article.priority-source[data-source-profile=ID]
      header (family, h3 name, publisher and product, coverage badge)
      p.priority-source__note (coverageNote)
      section[data-brief-section=useful-for] h4 1 - Useful for; p decision plus population
      section[data-brief-section=coverage] h4 2 - Coverage; dl geo/period/pop/grain compact rows, badges inline
      section[data-brief-section=available-info] h4 3 - Available info; ul up to 5 vars; a[data-dictionary-link] Open variable dictionary
      section[data-brief-section=access] h4 4 - Access; p nextAction; p restrictions
      section[data-brief-section=limits] h4 5 - Limits; ul up to 3 material limits
      section[data-brief-section=evidence] h4 6 - Evidence; ul readable publisher refs each anchor href plus precise locator
        details[data-provenance=technical-ids] summary Technical identifiers; raw record: and registry: IDs
      div.priority-source__actions (View source details internal with return context; Open official discovery route external; packet stays at brief header)

## 5. Preservation plan (must hold before and after)

- Mobile: keep 390px no-horizontal-overflow (grids collapse: summary 3 to 1, facts 2 to 1, catalog 4 to 1; packet button full-width; source header stacks). Verify with existing browser assessment plus new static-markup assertion (brief contains no fixed-width inline styles).
- Keyboard: native details and summary, links, buttons only; visible focus-visible; no tabindex traps in brief; evidence links real anchors; packet button reachable before sources.
- Focus: return-to-brief restores anchor search-result-navigator-profile plus focuses data-navigator-details; Escape and overlay behavior for mobile filters untouched; keep accessibility audit requiring both destinations plus focus call.
- Packet download: same filename (question.packetFilename), same contractVersion, metadata-only, mode-derived catalog block from ACTIVE_CATALOG; defer revoke, announce filename; no payload rows.
- Mode consistency: catalogMode.ts stays single source (baseline default /api/discover, candidate explicit /api/candidate/discover); brief, packet, notice, search, details, agents all derive from it (existing catalogMode same-catalog case); candidate records stay explicitly labeled, never silently replace baseline.
- Validators: validatePriorityResearchNavigator (20 questions, at least 8 families, per-source at least 10 facts, every fact bound), integration binding (refs vs retained evidenceIds), candidate arithmetic, mode-separation (no planner endpoints in browse/search) all stay green; new tests are additive.

## 6. Simplify-long-briefs plan

Default-collapsed: full 10-row dl plus technical IDs behind Show all evidence-bound facts details; section 6 Evidence shows readable links only. Budgets: section 3 up to 5 vars, section 5 up to 3 limits, Coverage 4 rows. Header keeps packet plus details links above the fold. Results heading (Results in selected order) must remain reachable without scrolling past more than one viewport of brief on desktop and mobile (assert via markup order: brief before results is kept, but brief default height bounded by collapsed details).

## 7. Failing-first tests (this commit, expected-red)

New file: apps/web/src/components/PriorityResearchBriefStructure.test.tsx — offline, no HTTP, uses current data plus renderToStaticMarkup:

- asserts six data-brief-section sections render in order 1 to 6 for an indexed (HCRIS) and a gap (SVI) brief;
- asserts section 3 contains representative vars plus data-dictionary-link https link;
- asserts section 6 renders readable publisher evidence anchors with precise locators, and raw record: and registry: IDs appear ONLY inside data-provenance technical-ids details;
- asserts packet download control plus mode-consistent generation preserved (passing preservation case).

These fail on today markup (no sections, no dictionary link, opaque refs as plain text) and pass after the integration step implements the section-4 template plus enrichment bindings. Existing suites (researchNavigator.test.ts, navigatorIntegration.test.ts, catalogMode.test.ts, modeSeparation.test.ts, PriorityResearchNavigator.test.tsx) are untouched.

## 8. Out of bounds

No live publisher requests (budget untouched), no request-ledger or frozen-cohort edits, no scientific acceptance, no production build or deploy, no corpus manifest edits, no validator weakening, no planner and browse mode mixing.
