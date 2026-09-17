import { ACTIVE_CATALOG } from './catalogMode'

export const RESEARCH_QUESTION_SET_VERSION = 'priority-questions-v1.0.0' as const

export const EVIDENCE_STATES = [
  'publisher_documented',
  'ushso_observed',
  'successfully_tested',
  'provisional',
  'conflicting',
  'unknown',
] as const

export type EvidenceState = (typeof EVIDENCE_STATES)[number]
export type SourceCoverage = 'indexed' | 'named_gap' | 'conflicting'

export interface ResearchFact {
  label: string
  value: string
  state: EvidenceState
  evidenceRefs: readonly string[]
}

export interface ResearchEvidenceLink {
  label: string
  url: string
  locator: string
}

export interface ResearchSourceProfile {
  id: string
  familyId: string
  name: string
  publisher: string
  product: string
  coverage: SourceCoverage
  coverageLabel: string
  coverageNote: string
  officialDiscoveryUrl: string
  catalogRecordId?: string
  evidenceRefs: readonly string[]
  facts: readonly ResearchFact[]
  nextAction: string
  joinLimitations: string
  dictionaryUrl?: string
  dictionaryLabel?: string
  representativeVars?: readonly string[]
  evidenceLinks?: readonly ResearchEvidenceLink[]
}

export interface PriorityResearchQuestion {
  id: string
  question: string
  searchTerms: readonly string[]
  familyIds: readonly string[]
  decision: string
  matchExplanation: string
  sourceProfileIds: readonly string[]
  nextAction: string
  packetFilename: string
}

export interface PriorityResearchEvidencePacket {
  contractVersion: 'ushso-priority-research-evidence-packet.v1.0.0'
  questionSetVersion: typeof RESEARCH_QUESTION_SET_VERSION
  questionId: string
  question: string
  decision: string
  matchExplanation: string
  catalog: {
    mode: 'baseline' | 'candidate'
    corpusVersion: string
    generation: string
    recordCount: number
    evidenceMode: 'published_offline_evidence'
  }
  sources: Array<{
    id: string
    familyId: string
    name: string
    publisher: string
    product: string
    coverage: SourceCoverage
    coverageLabel: string
    coverageNote: string
    officialDiscoveryUrl: string
    catalogRecordId?: string
    evidenceRefs: string[]
    facts: Array<ResearchFact>
    nextAction: string
    joinLimitations: string
    dictionaryUrl?: string
    dictionaryLabel?: string
    representativeVars?: string[]
    evidenceLinks?: ResearchEvidenceLink[]
  }>
  nextAction: string
  limitations: string[]
}

function fact(label: string, value: string, state: EvidenceState, evidenceRefs: readonly string[]): ResearchFact {
  return { label, value, state, evidenceRefs }
}

function recordRef(recordId: string, evidenceId: string) {
  return `record:${recordId}#${evidenceId}`
}

function registryRef(sourceId: string) {
  return `registry:named-source-registry.v1.0.0:${sourceId}`
}

interface IndexedProfileInput {
  id: string
  familyId: string
  name: string
  publisher: string
  product: string
  officialDiscoveryUrl: string
  catalogRecordId: string
  evidenceId: string
  population: string
  geography: string
  period: string
  grain: string
  cadence: string
  variables: string
  access: string
  joins: string
  nextAction: string
  factStates?: Partial<Record<'Geography' | 'Period' | 'Grain' | 'Cadence' | 'Variables / dictionary', EvidenceState>>
  dictionaryUrl?: string
  dictionaryLabel?: string
  representativeVars?: readonly string[]
  evidenceLinks?: readonly ResearchEvidenceLink[]
}

function indexedProfile(input: IndexedProfileInput): ResearchSourceProfile {
  const evidenceRefs = [recordRef(input.catalogRecordId, input.evidenceId)]
  return {
    id: input.id,
    familyId: input.familyId,
    name: input.name,
    publisher: input.publisher,
    product: input.product,
    coverage: 'indexed',
    coverageLabel: 'Indexed source record',
    coverageNote: 'The retained catalog record supports source discovery. Catalog membership does not prove payload access, authorization, or analytic fitness.',
    officialDiscoveryUrl: input.officialDiscoveryUrl,
    catalogRecordId: input.catalogRecordId,
    evidenceRefs,
    facts: [
      fact('Publisher', input.publisher, 'publisher_documented', evidenceRefs),
      fact('Product', input.product, 'publisher_documented', evidenceRefs),
      fact('Population / entity', input.population, 'publisher_documented', evidenceRefs),
      fact('Geography', input.geography, input.factStates?.['Geography'] ?? 'unknown', evidenceRefs),
      fact('Period', input.period, input.factStates?.['Period'] ?? 'unknown', evidenceRefs),
      fact('Grain', input.grain, input.factStates?.['Grain'] ?? 'unknown', evidenceRefs),
      fact('Cadence', input.cadence, input.factStates?.['Cadence'] ?? 'unknown', evidenceRefs),
      fact('Variables / dictionary', input.variables, input.factStates?.['Variables / dictionary'] ?? 'publisher_documented', evidenceRefs),
      fact('Access / cost / account', input.access, 'ushso_observed', evidenceRefs),
      fact('IDs / joins', input.joins, 'ushso_observed', evidenceRefs),
    ],
    nextAction: input.nextAction,
    joinLimitations: input.joins,
    ...(input.dictionaryUrl ? { dictionaryUrl: input.dictionaryUrl } : {}),
    ...(input.dictionaryLabel ? { dictionaryLabel: input.dictionaryLabel } : {}),
    ...(input.representativeVars ? { representativeVars: [...input.representativeVars] } : {}),
    ...(input.evidenceLinks ? { evidenceLinks: input.evidenceLinks.map((link) => ({ ...link })) } : {}),
  }
}

interface NamedGapInput {
  id: string
  sourceId: string
  familyId: string
  name: string
  publisher: string
  product: string
  officialDiscoveryUrl: string
  documented: boolean
  population: string
  access: string
  nextAction: string
  coverageNote?: string
  additionalFacts?: ResearchFact[]
  candidateRecordId?: string
  candidateEvidenceId?: string
  factStateOverrides?: Partial<Record<string, EvidenceState>>
  factValueOverrides?: Partial<Record<string, string>>
  dictionaryUrl?: string
  dictionaryLabel?: string
  representativeVars?: readonly string[]
  evidenceLinks?: readonly ResearchEvidenceLink[]
}

function namedGapProfile(input: NamedGapInput): ResearchSourceProfile {
  const evidenceRefs = [registryRef(input.sourceId)]
  if (ACTIVE_CATALOG.isCandidate && input.candidateRecordId && input.candidateEvidenceId) {
    evidenceRefs.push(recordRef(input.candidateRecordId, input.candidateEvidenceId))
  }
  const observedState: EvidenceState = input.documented ? 'publisher_documented' : 'ushso_observed'
  return {
    id: input.id,
    familyId: input.familyId,
    name: input.name,
    publisher: input.publisher,
    product: input.product,
    coverage: ACTIVE_CATALOG.isCandidate && input.candidateRecordId ? 'indexed' : 'named_gap',
    coverageLabel: ACTIVE_CATALOG.isCandidate && input.candidateRecordId ? 'Indexed documentation-first candidate' : 'Named source gap',
    coverageNote: ACTIVE_CATALOG.isCandidate && input.candidateRecordId
      ? 'This research candidate indexes publisher documentation, not payload data. Access, variables, and joins remain unverified.'
      : input.coverageNote ?? 'The named family is retained in the source registry but has no current indexed payload record in this build. This is a routing lead, not a source match or payload-access claim.',
    officialDiscoveryUrl: input.officialDiscoveryUrl,
    ...(ACTIVE_CATALOG.isCandidate && input.candidateRecordId ? { catalogRecordId: input.candidateRecordId } : {}),
    evidenceRefs,
    facts: [
      fact('Publisher / operator', `Registry-listed publisher or operator: ${input.publisher}`, observedState, evidenceRefs),
      fact('Product', `Registry-listed product: ${input.product}`, observedState, evidenceRefs),
      fact('Population / entity', input.population, 'unknown', evidenceRefs),
      fact('Geography', 'Not established in the indexed build; inspect the official source scope.', 'unknown', evidenceRefs),
      fact('Period', 'Not established in the indexed build; release or vintage is unresolved.', 'unknown', evidenceRefs),
      fact('Grain', 'Not established in the indexed build; do not infer row or file grain from the product name.', 'unknown', evidenceRefs),
      fact('Cadence', 'Not established in the indexed build.', 'unknown', evidenceRefs),
      fact('Variables / dictionary', 'No retained variable dictionary or field-level payload description.', 'unknown', evidenceRefs),
      fact('Access / cost / account', input.access, 'unknown', evidenceRefs),
      fact('IDs / joins', 'No retained source-native identifier, crosswalk, or compatible join route is established.', 'unknown', evidenceRefs),
      ...(input.additionalFacts ?? []),
    ].map((item) => {
      const state = input.factStateOverrides?.[item.label] ?? item.state
      const value = input.factValueOverrides?.[item.label] ?? item.value
      return state === item.state && value === item.value ? item : fact(item.label, value, state, item.evidenceRefs)
    }),
    nextAction: input.nextAction,
    joinLimitations: 'No join should be attempted until the publisher product, identifiers, grain, period, and access terms are verified.',
    ...(input.dictionaryUrl ? { dictionaryUrl: input.dictionaryUrl } : {}),
    ...(input.dictionaryLabel ? { dictionaryLabel: input.dictionaryLabel } : {}),
    ...(input.representativeVars ? { representativeVars: [...input.representativeVars] } : {}),
    ...(input.evidenceLinks ? { evidenceLinks: input.evidenceLinks.map((link) => ({ ...link })) } : {}),
  }
}

const indexedProfiles: ResearchSourceProfile[] = [
  indexedProfile({
    id: 'cms-hcris',
    factStates: { Period: 'publisher_documented' },
    familyId: 'cms-hcris',
    name: 'Healthcare Cost Report Information System',
    publisher: 'Centers for Medicare & Medicaid Services',
    product: 'Hospital Provider Cost Report',
    officialDiscoveryUrl: 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report',
    catalogRecordId: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
    evidenceId: 'evidence:cms-data-catalog:bf696c5e94f4146abe7ad61b',
    population: 'Hospitals and other provider entities represented in annual hospital cost reports.',
    geography: 'The retained description names provider information; geographic coverage is unresolved in the catalog metadata.',
    period: '2011-01-01 through 2023-12-31 in the retained catalog metadata.',
    grain: 'Catalog unit tags include hospital, facility, provider, and state; exact reporting grain is not asserted.',
    cadence: 'Annual cost-report product is described; current update cadence is source-determined and not independently tested.',
    variables: 'Facility characteristics, utilization, cost and charges by cost center, Medicare settlement, and financial statement fields are named; a complete dictionary is not retained here.',
    access: 'Public catalog metadata observed. Payload, current terms, authorization, and any account or cost requirement were not tested.',
    joins: 'CMS Certification Number is named in the description. No cross-source join compatibility is proven.',
    nextAction: 'Open the CMS product page, select the exact report period and fields, then verify current payload terms before retrieval.',
  }),
  indexedProfile({
    id: 'cms-chow',
    factStates: { Period: 'publisher_documented' },
    familyId: 'cms-provider-ownership',
    name: 'CMS hospital ownership change records',
    publisher: 'Centers for Medicare & Medicaid Services',
    product: 'Hospital Change of Ownership - Owner Information',
    officialDiscoveryUrl: 'https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-change-of-ownership-owner-information',
    catalogRecordId: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-60625-369694b51de508f8',
    evidenceId: 'evidence:cms-data-catalog:e12c427338817e1c69182ef2',
    population: 'Hospitals and individual or organizational buyer and seller entities.',
    geography: 'Provider addresses are described; geographic coverage is unresolved in the catalog metadata.',
    period: '2022-01-01 through 2026-06-30 in the retained catalog metadata.',
    grain: 'Provider and ownership-interest records are described; exact one-row-per-event grain is not asserted.',
    cadence: 'Update cadence is source-determined and not independently tested.',
    variables: 'Buyer and seller names, owner role, association date, address, and managerial-control details are named; formal dictionary is not retained.',
    access: 'Public catalog metadata observed. Payload, current terms, authorization, and account or cost requirements were not tested.',
    joins: 'Ownership identifiers and provider identifiers need source-side verification; no cross-source join is proven.',
    nextAction: 'Confirm the effective-date definition and source-native provider identifier on the CMS page before comparing ownership histories.',
  }),
  indexedProfile({
    id: 'cms-ltcf',
    factStates: { Period: 'publisher_documented' },
    familyId: 'cms-long-term-care',
    name: 'CMS nursing-home facility characteristics',
    publisher: 'Centers for Medicare & Medicaid Services',
    product: 'Long-Term Care Facility Characteristics (CMS Form 671)',
    officialDiscoveryUrl: 'https://data.cms.gov/quality-of-care/long-term-care-facility-characteristics',
    catalogRecordId: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-129a6-9d20dcfb9e53bafc',
    evidenceId: 'evidence:cms-data-catalog:452108cf7b2d0599c96396ab',
    population: 'Nursing homes submitting CMS Form 671 during annual surveys.',
    geography: 'Facility-level product; geographic coverage is unresolved in the catalog metadata.',
    period: '2023-10-01 through 2026-06-30 in the retained catalog metadata.',
    grain: 'Facility and survey-response unit tags are present; exact survey-year row grain is not asserted.',
    cadence: 'Annual survey collection is described; current publication cadence is not independently tested.',
    variables: 'Resident census, ownership, special-care units, facility characteristics, and staffing are named; formal dictionary is not retained.',
    access: 'Public catalog metadata observed. Payload, current terms, authorization, and account or cost requirements were not tested.',
    joins: 'Facility identity and certification identifiers need source-side verification; no cross-source join is proven.',
    nextAction: 'Confirm the survey vintage, facility identifier, and current download route at CMS before using the product.',
  }),
  indexedProfile({
    id: 'census-sahie',
    factStates: { Geography: 'publisher_documented', Period: 'publisher_documented', Cadence: 'publisher_documented', Grain: 'publisher_documented' },
    familyId: 'census-sahie',
    name: 'Census county health-insurance estimates',
    publisher: 'U.S. Census Bureau',
    product: 'Time Series Small Area Health Insurance Estimates (SAHIE)',
    officialDiscoveryUrl: 'https://api.census.gov/data/id/SAHIE',
    catalogRecordId: 'obs:asset:census-api:api.census.gov-data-id-sahie-6e4b062e3c39ea95',
    evidenceId: 'evidence:census-api:0eefa3911066b2b366a268a5',
    population: 'Single-year health-insurance coverage estimates for all U.S. counties by selected economic and demographic characteristics; the program models combine ACS data with administrative records and Census 2020 data.',
    geography: 'Publisher documents single-year estimates for all U.S. counties; county queries (FIPS 050) require a state predicate, with state (040) and national (010) levels and geography vintage reference 2020-01-01. Payload coverage has not been independently checked.',
    period: '2006 through 2024 in the retained catalog metadata; the retrieved dictionary enumerates YEAR 2006–2024 and the catalog temporal is 2006/2024.',
    grain: 'County, state, and national estimate records keyed by GEOID (State+County FIPS), STATE, COUNTY, US plus YEAR and AGECAT/IPRCAT/RACECAT/SEXCAT slices; the schema documents this grain vocabulary, and exact per-year row combinations require the year API response, which was not retrieved.',
    cadence: 'Publisher documents annual model-based estimates. Current release delivery has not been independently checked.',
    variables: 'A 39-variable dictionary was retrieved 2026-09-17: denominators NIPR_PT with NIC_PT (insured) / NUI_PT (uninsured) / PCTIC_PT / PCTUI_PT percents, each with MOE and 90% CI bounds, plus AGECAT, IPRCAT, RACECAT, SEXCAT descriptors and for/in/time predicates. Year-specific labels and universes still require the requested year\u2019s API.',
    access: 'Public catalog metadata observed; the catalog asserts accessLevel public with a CC0 license. API authorization, rate limits, current terms, and payload retrieval were not tested.',
    joins: 'GEOID (State+County FIPS), STATE, COUNTY, and STABREV are documented; joins require vintage and geography alignment and no cross-source join is proven.',
    nextAction: 'Open the SAHIE timeseries endpoint for the requested YEAR with for/in predicates (not the /data/id/ landing page, which returned 404 on 2026-09-17), then inspect the variables and geography schema and re-verify current terms.',
    dictionaryUrl: 'https://api.census.gov/data/timeseries/healthins/sahie/variables.json',
    dictionaryLabel: 'SAHIE 39-variable dictionary (variables.json, retrieved 2026-09-17)',
    representativeVars: ['NIPR_PT', 'NIC_PT', 'NUI_PT', 'PCTUI_PT', 'AGECAT'],
    evidenceLinks: [
      { label: 'Census API catalog entry for SAHIE (description, temporal, distribution)', url: 'https://api.census.gov/data.json', locator: 'dataset[329]: description, temporal 2006/2024, distribution timeseries endpoint; capture census-sahie-catalog-20260917-8af42774.json' },
      { label: 'SAHIE variable dictionary (39 variables)', url: 'https://api.census.gov/data/timeseries/healthins/sahie/variables.json', locator: 'variables YEAR, GEOID, NIPR_PT/NIC_PT/NUI_PT, AGECAT/IPRCAT/RACECAT/SEXCAT; capture census-sahie-variables-20260917-f7437f89.json' },
      { label: 'SAHIE geography predicates (county requires state)', url: 'https://api.census.gov/data/timeseries/healthins/sahie/geography.json', locator: 'fips us/010, state/040, county/050 requires state; capture census-sahie-geography-20260917-8c1b7a64.json' },
    ],
  }),
  indexedProfile({
    id: 'cdc-places',
    factStates: { Geography: 'publisher_documented', Period: 'publisher_documented', Grain: 'publisher_documented' },
    familyId: 'cdc-places',
    name: 'CDC local chronic-condition estimates',
    publisher: 'Centers for Disease Control and Prevention, Division of Population Health',
    product: 'PLACES: County Data (GIS Friendly Format), 2025 release',
    officialDiscoveryUrl: 'https://data.cdc.gov/d/i46a-9kgh',
    catalogRecordId: 'obs:asset:cdc-socrata:i46a-9kgh-600dcc5024ae0d18',
    evidenceId: 'evidence:cdc-socrata:ea4ac0a83796354ba59bd088',
    population: 'Local-area populations represented by model-based estimates across 40 measures, built from BRFSS 2023 (35 measures) or 2022 (5 biennial measures) plus Census 2023 county population and ACS multi-year data.',
    geography: 'Publisher description names county, place, census-tract, and ZCTA levels; this retained record is the county release. Join on CountyFIPS to the Census 2023 county boundaries.',
    period: '2025 release (view published 2025-12-04); measure observations are 2023 for 35 measures and 2022 for 5 biennial measures (teeth lost, dental visits, mammograms, colorectal screening, short sleep). Release year and observation year must not be equated.',
    grain: 'County-grain wide view with 168 columns: 6 geo/population keys (StateAbbr, StateDesc, CountyName, CountyFIPS, TotalPopulation, TotalPop18plus) plus 40 measures each with crude and age-adjusted prevalence and 95% CI fields. Row-key uniqueness was not payload-tested.',
    cadence: 'Release cadence is not stated in the retrieved view metadata (rows updated 2025-12-04 observed).',
    variables: 'A 168-column dictionary was retrieved 2026-09-17 with the <MEASURE>_{CrudePrev,AdjPrev,Crude95CI,Adj95CI} pattern (for example ACCESS2 lack of insurance 18–64, ARTHRITIS, COLON_SCREEN 45–75); denominators and age bounds live in column descriptions. Formal measure definitions require the CDC measure-definitions page, which was not fetched.',
    access: 'Public catalog metadata observed; view metadata asserts PUBLIC_DOMAIN with contact places@cdc.gov. Payload, current terms, authorization, and rate limits were not tested.',
    joins: 'CountyFIPS (plus StateAbbr) with 2023 boundary vintage required; no cross-source join is proven.',
    nextAction: 'Inspect the captured 168-column dictionary and confirm the exact measure, denominator, and 2023 geography vintage, then verify the current payload route before retrieval.',
    dictionaryUrl: 'https://data.cdc.gov/api/views/i46a-9kgh',
    dictionaryLabel: 'PLACES 2025 county view metadata (168-column dictionary, retrieved 2026-09-17)',
    representativeVars: ['ACCESS2_CrudePrev', 'ARTHRITIS_AdjPrev', 'COLON_SCREEN_CrudePrev', 'CountyFIPS', 'TotalPopulation'],
    evidenceLinks: [
      { label: 'CDC PLACES county product page', url: 'https://data.cdc.gov/d/i46a-9kgh', locator: '2025 county GIS-friendly release page; capture cdc-places-20260917-0aa0e46b.html' },
      { label: 'PLACES county view metadata and column dictionary', url: 'https://data.cdc.gov/api/views/i46a-9kgh', locator: 'description, 168 columns, publicationDate/rowsUpdatedAt 2025-12-04; capture cdc-places-metadata-20260917-e4fe3f56.json' },
    ],
  }),
  indexedProfile({
    id: 'cdc-maternal',
    factStates: { Geography: 'publisher_documented', Cadence: 'publisher_documented', Grain: 'publisher_documented', Period: 'provisional' },
    familyId: 'cdc-vsrr',
    name: 'CDC provisional maternal mortality estimates',
    publisher: 'Centers for Disease Control and Prevention, National Center for Health Statistics',
    product: 'VSRR Provisional Maternal Death Counts and Rates',
    officialDiscoveryUrl: 'https://data.cdc.gov/d/e2d5-ggg7',
    catalogRecordId: 'obs:asset:cdc-socrata:e2d5-ggg7-de73391d5d45d504',
    evidenceId: 'evidence:cdc-socrata:0221dc6e6e5715c056076445',
    population: 'Maternal deaths and live births represented in the National Vital Statistics System flow. A maternal death is a death while pregnant or within 42 days of termination from causes related to or aggravated by pregnancy (ICD-10 A34, O00–O95, O98–O99), excluding accidental or incidental causes.',
    geography: 'Publisher documents national-level maternal mortality rates with occurrence jurisdiction; payload coverage has not been independently checked.',
    period: 'Provisional 12-month-ending periods with Data As Of dating (for example June 2020 covers July 2019–June 2020); compare year-to-year, not month-to-month, because windows overlap.',
    grain: 'Publisher documents 12-month-ending estimate rows by jurisdiction and demographic group/subgroup carrying maternal deaths, 12-month-ending live births, rate per 100,000 live births, and footnote; the retrieved 12-column layout confirms this grain. Exact API row keys remain unverified.',
    cadence: 'Publisher documents quarterly updates and revisions as records arrive (view rows updated 2026-07-16 observed); USHSO has not monitored that schedule.',
    variables: 'Maternal deaths, live births, and mortality rate plus footnote in a 12-column layout retrieved 2026-09-17. Publisher suppresses counts of 1–9 and rates based on fewer than 20 deaths; provisional values can be revised. Suggested citation carries DOI 10.15620/cdc/20250305011; full technical notes were referenced but not fetched.',
    access: 'Public catalog metadata observed. Payload, current terms, authorization, and rate calculation inputs were not tested.',
    joins: 'Do not join to infant mortality or facility data without aligning denominator, period, geography, and revision status.',
    nextAction: 'Read the technical notes for the requested release and preserve the provisional label, Data As Of date, and revision caveat in any downstream analysis.',
    dictionaryUrl: 'https://data.cdc.gov/api/views/e2d5-ggg7',
    dictionaryLabel: 'Maternal VSRR view metadata (12-column layout, retrieved 2026-09-17)',
    representativeVars: ['Maternal Deaths', 'Live Births', 'Maternal Mortality Rate', 'Footnote', 'Data As Of'],
    evidenceLinks: [
      { label: 'CDC maternal VSRR product page', url: 'https://data.cdc.gov/d/e2d5-ggg7', locator: 'VSRR provisional maternal death counts and rates page; capture cdc-maternal-20260917-76b85329.html' },
      { label: 'Maternal VSRR view metadata and column layout', url: 'https://data.cdc.gov/api/views/e2d5-ggg7', locator: 'description, 12 columns, rowsUpdatedAt 2026-07-16; capture cdc-maternal-metadata-20260917-1cebff77.json' },
    ],
  }),
  indexedProfile({
    id: 'cdc-infant',
    factStates: { Period: 'provisional', Cadence: 'publisher_documented' },
    familyId: 'cdc-vsrr',
    name: 'CDC provisional infant mortality estimates',
    publisher: 'Centers for Disease Control and Prevention, National Center for Health Statistics',
    product: 'NCHS - VSRR Quarterly provisional estimates for infant mortality',
    officialDiscoveryUrl: 'https://data.cdc.gov/d/jqwm-z2g9',
    catalogRecordId: 'obs:asset:cdc-socrata:jqwm-z2g9-555905c82c55ca78',
    evidenceId: 'evidence:cdc-socrata:d4f3eee7a07c3d9567960ee1',
    population: 'Infant deaths, neonatal deaths, postneonatal deaths, and live births in provisional mortality reporting.',
    geography: 'Record unit tags include state; complete geographic scope is unresolved in the retained metadata.',
    period: 'Quarterly provisional estimates; exact release window is not resolved in the retained metadata.',
    grain: 'State unit tag is present; exact quarter, rate, and cause row grain require the source dictionary.',
    cadence: 'Quarterly provisional product as named by the title; current cadence is not independently tested.',
    variables: 'Infant, neonatal, and postneonatal mortality rates plus leading causes are named; definitions and denominators require technical notes.',
    access: 'Public catalog metadata observed. Payload, current terms, authorization, and rate calculation inputs were not tested.',
    joins: 'Do not equate this product with maternal mortality; align period, denominator, geography, and provisional revision state before comparison.',
    nextAction: 'Inspect the technical notes and release slice, then record whether the requested comparison uses infant, neonatal, or postneonatal mortality.',
  }),
  indexedProfile({
    id: 'cdc-brfss',
    factStates: { Geography: 'publisher_documented', Grain: 'publisher_documented' },
    familyId: 'cdc-brfss',
    name: 'CDC adult behavioral-health survey indicators',
    publisher: 'Centers for Disease Control and Prevention',
    product: 'Behavioral Risk Factor Surveillance System (BRFSS) - Mental Health Indicators',
    officialDiscoveryUrl: 'https://data.cdc.gov/d/5eh7-pjx8',
    catalogRecordId: 'obs:asset:cdc-socrata:5eh7-pjx8-656340c3c185411a',
    evidenceId: 'evidence:cdc-socrata:2cc75bcbdd79d96843c056eb',
    population: 'U.S. adults responding to telephone interviews about behaviors, conditions, and preventive services; this product reports mental-health indicators for participating jurisdictions.',
    geography: 'Publisher describes the broader BRFSS system as covering all 50 states, D.C., and three territories. This mental-health product covers participating jurisdictions; nationwide estimates are not available. The retrieved view metadata confirms state as the geographic unit of analysis.',
    period: 'A Year column is present but series bounds are unresolved in the retrieved metadata (view created 2025-05-02, rows updated 2026-01-28); do not conflate view dates with observation years.',
    grain: 'Estimate rows over Year, Question, Area and Area abbreviation, and Demographics_Type/Value carrying Percent with 95% CI bounds, formatted CI, data label, and percentile range (12 columns retrieved 2026-09-17); row-key uniqueness was not payload-tested.',
    cadence: 'Continuous state-based surveillance is described; current publication cadence is not stated in the retrieved metadata.',
    variables: 'A 12-column dictionary was retrieved 2026-09-17. Survey questions, weighting, denominators, and suppression rules live in BRFSS methodology, which was referenced but not fetched.',
    access: 'Public catalog metadata observed, with contact mentalhealthdata@cdc.gov and a suggested citation in the view metadata. Payload, current terms, authorization, and rate limits were not tested.',
    joins: 'Survey estimates (Area/Area_abbr state identifiers) must not be joined to facility directories without compatible geography, period, population, and weighting definitions.',
    nextAction: 'Choose the indicator, year, and demographic slice, then inspect the BRFSS weighting, denominator, and suppression documentation before citing a prevalence.',
    dictionaryUrl: 'https://data.cdc.gov/api/views/5eh7-pjx8',
    dictionaryLabel: 'BRFSS mental-health view metadata (12-column dictionary, retrieved 2026-09-17)',
    representativeVars: ['Year', 'Question', 'Area', 'Percent', 'Low_Confidence_Limit'],
    evidenceLinks: [
      { label: 'CDC BRFSS mental-health product page', url: 'https://data.cdc.gov/d/5eh7-pjx8', locator: 'BRFSS mental-health indicators page; capture cdc-brfss-20260917-2fa6728f.html' },
      { label: 'BRFSS mental-health view metadata and columns', url: 'https://data.cdc.gov/api/views/5eh7-pjx8', locator: 'description, 12 columns, state unit, created 2025-05-02; capture cdc-brfss-metadata-20260917-4ed255dd.json' },
    ],
  }),
]

const gapProfiles: ResearchSourceProfile[] = [
  namedGapProfile({
    id: 'ahrq-hcup', sourceId: 'ahrq-hcup', familyId: 'ahrq-hcup',
    name: 'Healthcare Cost and Utilization Project', publisher: 'Agency for Healthcare Research and Quality', product: 'AHRQ HCUP databases',
    officialDiscoveryUrl: 'https://hcup-us.ahrq.gov/databases.jsp', documented: true,
    population: 'Hospital and other health-care utilization encounters; exact database and population are unresolved for this question.',
    access: 'Official route is retained. Database application, data-use agreement, pricing, and account requirements were not executed.',
    nextAction: 'Choose the HCUP database and year, then review the application, DUA, cost, and restricted-use terms.',
  }),
  namedGapProfile({
    id: 'ahrq-meps', sourceId: 'ahrq-meps', familyId: 'ahrq-meps',
    name: 'Medical Expenditure Panel Survey', publisher: 'Agency for Healthcare Research and Quality', product: 'AHRQ MEPS public-use and survey files',
    officialDiscoveryUrl: 'https://meps.ahrq.gov/mepsweb/data_stats/download_data_files.jsp', documented: true,
    population: 'People, households, events, and medical expenditures represented by the selected MEPS component.',
    access: 'Official download route is retained. File selection, current terms, account requirements, and payload retrieval were not executed.',
    nextAction: 'Select the MEPS panel/component and year, then inspect the codebook, public-use boundary, and file download terms.',
  }),
  namedGapProfile({
    id: 'ahrq-compendium', sourceId: 'ahrq-compendium', familyId: 'ahrq-compendium',
    name: 'AHRQ Compendium of U.S. Health Systems', publisher: 'Agency for Healthcare Research and Quality', product: 'Compendium of U.S. Health Systems',
    officialDiscoveryUrl: 'https://www.ahrq.gov/chsp/data-resources/compendium-2020.html', documented: true,
    population: 'Health systems and affiliated hospitals or organizations represented by the selected compendium vintage.',
    access: 'Official documentation route is retained. Current file availability, terms, account requirements, and payload retrieval were not executed.',
    nextAction: 'Open the technical documentation, choose a vintage, and verify system, hospital, and organization identifiers before use.',
  }),
  namedGapProfile({
    id: 'cms-nppes', sourceId: 'cms-nppes', familyId: 'cms-nppes',
    name: 'National Plan and Provider Enumeration System', publisher: 'Centers for Medicare & Medicaid Services', product: 'NPPES NPI files and NPI Registry',
    officialDiscoveryUrl: 'https://download.cms.gov/nppes/NPI_Files.html', documented: true,
    population: 'Individual (Type 1) and organizational (Type 2) health-care providers with NPI enumeration records; the page names the NPI Downloadable File V2 family (monthly, weekly incremental, monthly deactivation) with 3 reference files per zip (other names, practice locations, endpoints).',
    access: 'The public NPI Files page with direct V2 links was observed 2026-09-17; file terms, cost, account, and rate limits were not verified, and bulk zips were not retrieved under the documentation operation exclusion.',
    nextAction: 'Open the NPI Files page, then obtain the Data Dissemination readme and file-layout terms through the documented CMS route before planning any NPI, taxonomy, or address join.',
    factStateOverrides: { 'Population / entity': 'publisher_documented', Period: 'ushso_observed', Cadence: 'ushso_observed', 'Access / cost / account': 'ushso_observed' },
    factValueOverrides: {
      Period: 'Current-file dating observed 2026-09-17 (monthly files 2026-09-14; weekly window 090726–091326; V1 ends 03/03/2026); enumeration coverage window is unresolved.',
      Cadence: 'Monthly plus weekly-incremental plus monthly-deactivation file rhythm observed on the page; schedule adherence was not tested.',
      'Variables / dictionary': 'No dictionary retrieved: the readme ships inside the excluded bulk zips, so taxonomy, address, and identifier fields are unconfirmed.',
      'IDs / joins': 'NPI enumeration for Type 1/2 is referenced, but taxonomy and address keys are unconfirmed; NPI-to-CCN style merges are unproven, so no join should be attempted.',
    },
    evidenceLinks: [
      { label: 'CMS NPI Files product page (V2 family, reference files, readme note)', url: 'https://download.cms.gov/nppes/NPI_Files.html', locator: 'h1 NPI Files, V2 sections, reference-file list; capture cms-nppes-20260917-8309e853.html' },
    ],
  }),
  namedGapProfile({
    id: 'hrsa-ahrf', sourceId: 'hrsa-ahrf', familyId: 'hrsa-ahrf',
    name: 'HRSA Area Health Resources Files', publisher: 'Health Resources and Services Administration', product: 'Area Health Resources Files (AHRF)',
    officialDiscoveryUrl: 'https://data.hrsa.gov/topics/health-workforce/ahrf', documented: true,
    candidateRecordId: 'obs:asset:candidate-ahrf-documentation-v1', candidateEvidenceId: 'evidence:candidate-ahrf-documentation-v1',
    population: 'County, state, and national health-workforce and resources entities from 50+ sources: county files cover physicians, dentists, nurses, and PAs, while state files carry SOC-coded professions; the dashboard is a subset of the full files.',
    access: 'The official AHRF page and download route were observed 2026-09-17; cost, account, and download terms were not verified or executed.',
    nextAction: 'Open the AHRF page download route, identify the exact dated file plus technical documentation, and follow HRSA terms before citing any workforce count.',
    factStateOverrides: { 'Population / entity': 'publisher_documented', Geography: 'publisher_documented', Period: 'publisher_documented', Grain: 'publisher_documented', Cadence: 'publisher_documented', 'Variables / dictionary': 'publisher_documented' },
    factValueOverrides: {
      Geography: 'County, state, and national levels; Connecticut carries a dual FIPS scheme (8 counties plus 9 planning regions) with mixed source usage.',
      Period: 'Annual releases by Bureau fiscal year with per-variable data years differing within a release (2024–2025 example documented); dashboard shows calendar years with 2024–2019 observed.',
      Grain: 'County-level file versus state-level file, plus dashboard slices by year, profession, population, and location; county sums do not equal state or national counts because sources differ.',
      Cadence: 'Annual release by the Bureau of Health Workforce, fiscal-year dated.',
      'Variables / dictionary': 'Profession definitions, the state SOC code table, the clinician rate formula (per 100,000), and suppression rules (state PRSE above 30% and unavailable county cells become NA) are documented in the retrieved definition PDF; full file technical documentation at the download route was not retrieved.',
      'IDs / joins': 'County and state FIPS (both Connecticut schemes) are the documented geographic keys; county-to-state aggregation is explicitly invalid and no cross-source join is proven.',
    },
    dictionaryUrl: 'https://data.hrsa.gov/Content/Documents/topics/AHRF%20Definition.pdf',
    dictionaryLabel: 'AHRF Methods and Definition (PDF, retrieved 2026-09-17)',
    representativeVars: ['County physicians (AMA)', 'County dentists (ADA)', 'State SOC-coded professions', 'Clinician rate per 100,000', 'FIPS geography keys'],
    evidenceLinks: [
      { label: 'HRSA AHRF product and documentation page', url: 'https://data.hrsa.gov/topics/health-workforce/ahrf', locator: 'Description, county/state file labels, year select; capture hrsa-ahrf-20260917-ae2da48a.html' },
      { label: 'AHRF definition and methods (PDF)', url: 'https://data.hrsa.gov/Content/Documents/topics/AHRF%20Definition.pdf', locator: 'pp.1–6: release years, Connecticut scheme, SOC table, suppression, rate formula; capture hrsa-ahrf-definition-20260917-958bfbce.pdf' },
    ],
  }),
  namedGapProfile({
    id: 'samhsa-facility-services', sourceId: 'samhsa-facility-services', familyId: 'samhsa-facility-services',
    name: 'SAMHSA facility services data', publisher: 'Substance Abuse and Mental Health Services Administration', product: 'National Substance Use and Mental Health Services Survey facility data',
    officialDiscoveryUrl: 'https://www.samhsa.gov/data/data-we-collect/n-sumhss-national-substance-use-and-mental-health-services-survey', documented: false,
    population: 'Substance-use and mental-health treatment facilities; exact survey universe and facility product are unresolved.',
    access: 'Registry retains an official locator, but current access, cost, account, and file terms were not verified or executed.',
    nextAction: 'Inspect the N-SUMHSS documentation and survey vintage, then verify facility identifiers, service fields, geography, and access terms.',
  }),
  namedGapProfile({
    id: 'cms-tmsis-taf', sourceId: 'cms-tmsis-taf', familyId: 'cms-tmsis-taf',
    name: 'CMS T-MSIS Analytic Files', publisher: 'Centers for Medicare & Medicaid Services', product: 'T-MSIS Analytic Files / Medicaid and CHIP research files',
    officialDiscoveryUrl: 'https://www.medicaid.gov/medicaid/data-systems/macbis/medicaid-chip-research-files', documented: false,
    population: 'Medicaid and CHIP beneficiaries, claims, enrollment, and service events in the selected research file.',
    access: 'Registry retains an official locator, but application, DUA, pricing, account, restricted-use, and payload terms were not verified or executed.',
    nextAction: 'Review the Medicaid research-file application and DUA, then select the file type, period, eligibility universe, and approved access path.',
  }),
  namedGapProfile({
    id: 'cdc-atsdr-svi', sourceId: 'cdc-atsdr-svi', familyId: 'cdc-atsdr-svi',
    name: 'CDC/ATSDR Social Vulnerability Index', publisher: 'CDC/Agency for Toxic Substances and Disease Registry', product: 'Social Vulnerability Index (SVI)',
    officialDiscoveryUrl: 'https://www.atsdr.cdc.gov/place-health/php/svi/index.html', documented: false,
    population: 'Communities represented by the selected SVI geography and release; exact population universe is unresolved.',
    access: 'Registry retains an official locator, but current release, terms, account, and payload route were not verified or executed.',
    nextAction: 'Inspect the ATSDR SVI release documentation and confirm geography vintage, score construction, variables, and download route.',
    coverageNote: 'No exact SVI record is indexed. A similarly named CDC catalog record was retained for vaccine-hesitancy metadata, but its description is not SVI evidence and is deliberately not substituted.',
    additionalFacts: [fact('Name collision', 'A retained CDC record with a similar title describes vaccine-hesitancy estimates, not the requested SVI product.', 'conflicting', ['record:obs:asset:cdc-socrata:ypqf-r5qs-6dc6d74beda98d6a#evidence:cdc-socrata:41cb563a59e97141e0520044'])],
  }),
  namedGapProfile({
    id: 'state-apcd-programs', sourceId: 'state-apcd-programs', familyId: 'state-apcd-programs',
    name: 'State all-payer claims database programs', publisher: 'State APCD programs and their administering entities', product: 'State APCD program directories and data-access routes',
    officialDiscoveryUrl: 'https://www.apcdcouncil.org/state-apcd-activities', documented: false,
    population: 'State all-payer claims populations; state participation and covered services are unresolved.',
    access: 'Registry retains a national locator, but state-specific applications, DUAs, costs, accounts, and payload routes were not verified or executed.',
    nextAction: 'Choose the target state, inspect its APCD program and data request route, and document the covered payers, years, and restrictions.',
  }),
  namedGapProfile({
    id: 'state-facility-licensure', sourceId: 'state-facility-licensure', familyId: 'state-facility-licensure',
    name: 'State facility licensure directories', publisher: 'State licensing authorities', product: 'State health-care facility license and certification directories',
    officialDiscoveryUrl: 'https://www.cms.gov/medicare/health-safety-standards/certification-compliance', documented: false,
    population: 'Licensed or certified health-care facilities in the selected state; facility class is unresolved.',
    access: 'Registry retains a certification-context locator, but state-specific access, terms, account, and payload routes were not verified or executed.',
    nextAction: 'Choose the state and facility class, then inspect the state licensing authority’s current directory, identifiers, and update notes.',
  }),
  namedGapProfile({
    id: 'rural-hospital-closure-tracking', sourceId: 'rural-hospital-closure-tracking', familyId: 'rural-hospital-closure-tracking',
    name: 'Rural hospital closure tracking', publisher: 'Cecil G. Sheps Center for Health Services Research, University of North Carolina', product: 'Rural hospital closure tracking and methodology',
    officialDiscoveryUrl: 'https://www.shepscenter.unc.edu/programs-projects/rural-health/rural-hospital-closures/', documented: false,
    candidateRecordId: 'obs:asset:candidate-sheps-closures-documentation-v1', candidateEvidenceId: 'evidence:candidate-sheps-closures-documentation-v1',
    population: 'Rural hospitals and closure events represented by the selected Sheps Center list or vintage.',
    access: 'Registry retains an official locator, but current access, file format, vintage, account, and payload terms were not verified or executed.',
    nextAction: 'Inspect the Sheps methodology and current closure list, then record the event definition, reporting period, facility identifier, and limitations.',
  }),
  namedGapProfile({
    id: 'aha-annual-survey', sourceId: 'aha-annual-survey', familyId: 'aha-annual-survey',
    name: 'AHA Annual Survey', publisher: 'American Hospital Association', product: 'AHA Annual Survey Database',
    officialDiscoveryUrl: 'https://www.ahadata.com/aha-annual-survey-database', documented: false,
    population: 'Hospitals and health-care organizations participating in the selected AHA survey vintage.',
    access: 'Registry retains an official locator, but license, pricing, account, file, and payload terms were not verified or executed.',
    nextAction: 'Inspect the AHA product terms and documentation, then verify the vintage, participating-entity scope, variables, license, and cost.',
  }),
]

export const RESEARCH_SOURCE_PROFILES: readonly ResearchSourceProfile[] = [...indexedProfiles, ...gapProfiles]

const questions: PriorityResearchQuestion[] = [
  {
    id: 'hospital-finance-hcris', question: 'Which CMS hospital cost-report fields support a Pennsylvania hospital finance comparison?', searchTerms: ['cms hcris hospital cost', 'hospital cost-report', 'hospital cost report', 'hcris'], familyIds: ['cms-hcris'], decision: 'Compare hospital cost, charge, utilization, and settlement measures without treating them as patient-level claims.', matchExplanation: 'The question names HCRIS and hospital cost reports; the indexed CMS record explicitly describes annual hospital cost-report measures and CMS Certification Number organization.', sourceProfileIds: ['cms-hcris'], nextAction: 'Select the exact HCRIS report period and fields at CMS, then verify the current payload and definitions.', packetFilename: 'ushso-priority-hospital-finance-hcris.json',
  },
  {
    id: 'hospital-ownership', question: 'Which CMS records describe hospital ownership changes and effective dates?', searchTerms: ['hospital ownership', 'cms ownership changes', 'change of ownership'], familyIds: ['cms-provider-ownership'], decision: 'Trace buyer, seller, owner role, and effective-date metadata for hospital ownership research.', matchExplanation: 'The indexed CMS ownership product names buyer and seller organizations, owner role, association date, addresses, and managerial-control details.', sourceProfileIds: ['cms-chow'], nextAction: 'Confirm the effective-date and provider-identifier definitions at CMS before constructing a history.', packetFilename: 'ushso-priority-hospital-ownership.json',
  },
  {
    id: 'county-uninsured', question: 'Which retained source provides county uninsured estimates for 2006–2024?', searchTerms: ['county uninsured', 'sahie', 'health insurance estimates'], familyIds: ['census-sahie'], decision: 'Locate county health-insurance estimates with explicit year and denominator checks.', matchExplanation: 'The retained SAHIE record says it produces single-year health-insurance coverage estimates for all U.S. counties and bounds the catalog period to 2006–2024.', sourceProfileIds: ['census-sahie'], nextAction: 'Inspect the requested SAHIE year’s API variables, geography predicates, and release notes.', packetFilename: 'ushso-priority-county-uninsured-sahie.json',
  },
  {
    id: 'county-health-prevalence', question: 'Which CDC PLACES release supports county chronic-condition prevalence mapping?', searchTerms: ['cdc places', 'cdc places county', 'county chronic condition', 'places prevalence'], familyIds: ['cdc-places'], decision: 'Choose a county-level PLACES release and preserve measure, denominator, geography vintage, and model-based status.', matchExplanation: 'The indexed CDC record is the 2025 PLACES county GIS-friendly release and names model-based local estimates across four geography levels.', sourceProfileIds: ['cdc-places'], nextAction: 'Inspect the release dictionary and confirm the exact measure and geography boundary vintage.', packetFilename: 'ushso-priority-county-health-places.json',
  },
  {
    id: 'maternal-mortality', question: 'Where can I find provisional maternal mortality counts and rates?', searchTerms: ['maternal mortality', 'maternal death counts', 'vsrr maternal'], familyIds: ['cdc-vsrr'], decision: 'Find a provisional maternal mortality series while preserving revision status and denominator definitions.', matchExplanation: 'The indexed CDC VSRR record explicitly describes national provisional maternal death counts and rates per 100,000 live births.', sourceProfileIds: ['cdc-maternal'], nextAction: 'Read the technical notes and retain the provisional release date and revision caveat.', packetFilename: 'ushso-priority-maternal-mortality.json',
  },
  {
    id: 'infant-mortality', question: 'Where can I find quarterly provisional infant, neonatal, and postneonatal mortality rates?', searchTerms: ['infant mortality', 'neonatal mortality', 'vsrr infant'], familyIds: ['cdc-vsrr'], decision: 'Distinguish infant, neonatal, and postneonatal rates before comparing mortality series.', matchExplanation: 'The indexed CDC VSRR quarterly record names infant, neonatal, postneonatal rates and leading causes of infant death.', sourceProfileIds: ['cdc-infant'], nextAction: 'Select the exact quarter and rate definition from the CDC technical notes.', packetFilename: 'ushso-priority-infant-mortality.json',
  },
  {
    id: 'behavioral-health-brfss', question: 'Which survey supports state behavioral-health prevalence estimates for adults?', searchTerms: ['behavioral-health', 'behavioral health prevalence', 'brfss mental health', 'adult mental health survey'], familyIds: ['cdc-brfss'], decision: 'Find a state-based adult survey indicator without confusing prevalence estimates with facility capacity.', matchExplanation: 'The retained BRFSS mental-health record describes adult telephone interviews across states and territories and names mental-health indicators.', sourceProfileIds: ['cdc-brfss'], nextAction: 'Choose the indicator and year, then inspect BRFSS weighting, denominator, and suppression documentation.', packetFilename: 'ushso-priority-behavioral-health-brfss.json',
  },
  {
    id: 'long-term-care-facilities', question: 'Which CMS product describes nursing-home facility characteristics and staffing?', searchTerms: ['nursing-home', 'long term care facility', 'nursing home characteristics', 'nursing home staffing'], familyIds: ['cms-long-term-care'], decision: 'Locate nursing-home facility characteristics while separating annual survey data from staffing and quality products.', matchExplanation: 'The indexed CMS Form 671 product names resident census, ownership, special-care units, facility characteristics, and staffing.', sourceProfileIds: ['cms-ltcf'], nextAction: 'Confirm the survey vintage and facility identifier at CMS before using the fields.', packetFilename: 'ushso-priority-long-term-care-facilities.json',
  },
  {
    id: 'ahrq-hcup-inpatient', question: 'Where is the AHRQ HCUP inpatient utilization file for the requested year?', searchTerms: ['hcup inpatient', 'ahrq hcup', 'hospital utilization file'], familyIds: ['ahrq-hcup'], decision: 'Route to the correct HCUP inpatient database and understand its restricted application boundary.', matchExplanation: 'HCUP is named in the retained registry with an official databases page, but no current indexed payload record or exact database/year is retained.', sourceProfileIds: ['ahrq-hcup'], nextAction: 'Choose the HCUP database and year, then complete the documented application and DUA review.', packetFilename: 'ushso-priority-ahrq-hcup.json',
  },
  {
    id: 'ahrq-meps-expenditures', question: 'Which AHRQ MEPS file supports medical-expenditure estimates by person or event?', searchTerms: ['meps expenditures', 'ahrq meps', 'medical expenditure survey'], familyIds: ['ahrq-meps'], decision: 'Select a MEPS public-use component and preserve its panel, event, person, and expenditure definitions.', matchExplanation: 'MEPS is named in the retained registry with an official download route, but the current indexed build has no exact MEPS source record.', sourceProfileIds: ['ahrq-meps'], nextAction: 'Select the MEPS component and panel, then inspect its codebook and public-use terms.', packetFilename: 'ushso-priority-ahrq-meps.json',
  },
  {
    id: 'ahrq-health-systems', question: 'Which AHRQ Compendium release identifies U.S. health systems and affiliated hospitals?', searchTerms: ['ahrq compendium', 'health systems compendium', 'us health systems'], familyIds: ['ahrq-compendium'], decision: 'Identify a health-system and affiliated-hospital reference vintage without inventing organization joins.', matchExplanation: 'The retained registry names the AHRQ Compendium and its technical-documentation route, but no current indexed payload record is available.', sourceProfileIds: ['ahrq-compendium'], nextAction: 'Choose a compendium vintage and inspect the technical documentation and identifiers.', packetFilename: 'ushso-priority-ahrq-compendium.json',
  },
  {
    id: 'nppes-provider-identity', question: 'Where can I find the NPI registry or NPPES provider identity files?', searchTerms: ['nppes provider identity', 'npi registry', 'cms nppes'], familyIds: ['cms-nppes'], decision: 'Route to source-native NPI and provider taxonomy fields before attempting identity linkage.', matchExplanation: 'NPPES is an exact named source in the retained registry with CMS’s official file route, but it is not indexed in the current build.', sourceProfileIds: ['cms-nppes'], nextAction: 'Inspect the current NPPES file layout and confirm the identifier and taxonomy fields needed for the join.', packetFilename: 'ushso-priority-nppes.json',
  },
  {
    id: 'hrsa-workforce', question: 'Which HRSA AHRF files describe county health-workforce supply?', searchTerms: ['ahrf workforce', 'health-workforce', 'health workforce county', 'hrsa ahrf', 'hrsa area health resources'], familyIds: ['hrsa-ahrf'], decision: 'Find county workforce measures with release, geography, and field definitions explicit.', matchExplanation: 'AHRF is an exact named source and the candidate build retains a documentation-first locator, but no payload or verified dictionary is indexed.', sourceProfileIds: ['hrsa-ahrf'], nextAction: 'Inspect HRSA AHRF documentation and verify the release, county fields, workforce definitions, and access route.', packetFilename: 'ushso-priority-hrsa-ahrf.json',
  },
  {
    id: 'samhsa-facilities', question: 'Where can I find national behavioral-health treatment facility services data?', searchTerms: ['samhsa facilities', 'behavioral-health treatment', 'behavioral health facilities', 'n-sumhss'], familyIds: ['samhsa-facility-services'], decision: 'Route to facility-level treatment-service metadata without substituting prevalence survey results.', matchExplanation: 'SAMHSA facility services data is an exact named registry family, but no current indexed facility payload record is retained.', sourceProfileIds: ['samhsa-facility-services'], nextAction: 'Inspect the N-SUMHSS survey vintage and verify facility identifiers, services, geography, and access terms.', packetFilename: 'ushso-priority-samhsa-facilities.json',
  },
  {
    id: 'tmsis-medicaid-claims', question: 'What is the access route for CMS T-MSIS or TAF Medicaid claims research files?', searchTerms: ['tmsis claims', 'taf medicaid', 'medicaid research files'], familyIds: ['cms-tmsis-taf'], decision: 'Understand the approved-access boundary for Medicaid and CHIP analytic files before planning claims research.', matchExplanation: 'T-MSIS/TAF is an exact named registry family with a Medicaid.gov research-file route, but access, DUA, and payload are not established in the build.', sourceProfileIds: ['cms-tmsis-taf'], nextAction: 'Review the CMS/Medicaid application and DUA, then select the file type and approved period.', packetFilename: 'ushso-priority-tmsis-taf.json',
  },
  {
    id: 'svi-social-vulnerability', question: 'Where is the CDC/ATSDR Social Vulnerability Index for the requested geography vintage?', searchTerms: ['social vulnerability index', 'cdc svi', 'atsdr svi'], familyIds: ['cdc-atsdr-svi'], decision: 'Locate the exact SVI release and geography vintage without substituting a similarly named CDC dataset.', matchExplanation: 'SVI is an exact named gap; the retained build explicitly records a conflicting similarly titled CDC record and refuses to treat it as SVI evidence.', sourceProfileIds: ['cdc-atsdr-svi'], nextAction: 'Inspect the ATSDR release documentation and verify score variables, geography vintage, and download route.', packetFilename: 'ushso-priority-svi.json',
  },
  {
    id: 'state-apcd', question: 'Which state APCD program can answer a multi-payer claims question?', searchTerms: ['state apcd', 'all payer claims', 'apcd program'], familyIds: ['state-apcd-programs'], decision: 'Choose a state-specific all-payer claims route without inferring national completeness or unrestricted access.', matchExplanation: 'State APCD programs are an exact named family with a retained APCD Council locator, but state-specific coverage and access are not indexed.', sourceProfileIds: ['state-apcd-programs'], nextAction: 'Choose the target state and document its covered payers, periods, application, DUA, cost, and identifiers.', packetFilename: 'ushso-priority-state-apcd.json',
  },
  {
    id: 'state-facility-licensure', question: 'Where can I find a state facility licensure directory for a chosen facility class?', searchTerms: ['facility licensure', 'state licensed facilities', 'state facility directory'], familyIds: ['state-facility-licensure'], decision: 'Route to a state licensing directory with facility class, identifier, status, and update definitions explicit.', matchExplanation: 'State facility licensure is an exact named family, but the retained locator is only a federal certification-context route and no state directory is indexed.', sourceProfileIds: ['state-facility-licensure'], nextAction: 'Choose the state and facility class, then inspect the authoritative state directory and identifiers.', packetFilename: 'ushso-priority-state-licensure.json',
  },
  {
    id: 'rural-hospital-closures', question: 'Which source tracks rural hospital closures and closure dates?', searchTerms: ['rural hospital closures', 'sheps closures', 'hospital closure dates'], familyIds: ['rural-hospital-closure-tracking'], decision: 'Find a closure-event list while preserving operator identity, event definition, vintage, and facility identifiers.', matchExplanation: 'The retained Sheps source profile is an exact named gap and the candidate build contains a documentation-first closure-tracking entry, not a verified payload.', sourceProfileIds: ['rural-hospital-closure-tracking'], nextAction: 'Inspect the Sheps methodology and current list, then record the event definition and reporting period.', packetFilename: 'ushso-priority-rural-hospital-closures.json',
  },
  {
    id: 'aha-hospital-survey', question: 'Which AHA Annual Survey product describes hospital capacity and services?', searchTerms: ['aha annual survey', 'aha hospital survey', 'hospital capacity survey'], familyIds: ['aha-annual-survey'], decision: 'Route to the correct AHA survey vintage and licensed field set for hospital capacity research.', matchExplanation: 'AHA Annual Survey is an exact named family with a retained product locator, but no current indexed product or license terms are retained.', sourceProfileIds: ['aha-annual-survey'], nextAction: 'Inspect AHA documentation and terms, then verify the vintage, participating entities, variables, license, and cost.', packetFilename: 'ushso-priority-aha-annual-survey.json',
  },
]

export const PRIORITY_RESEARCH_QUESTIONS: readonly PriorityResearchQuestion[] = questions

const profileById = new Map(RESEARCH_SOURCE_PROFILES.map((profile) => [profile.id, profile]))

export function sourceProfileForId(id: string) {
  return profileById.get(id) ?? null
}

export function findPriorityResearchQuestion(value: string) {
  const normalizeQuestionText = (text: string) => text.trim().toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ')
  const normalized = normalizeQuestionText(value)
  if (normalized.length < 4) return null
  const exactQuestion = PRIORITY_RESEARCH_QUESTIONS.find((question) => normalizeQuestionText(question.question) === normalized)
  if (exactQuestion) return exactQuestion
  const matches = PRIORITY_RESEARCH_QUESTIONS.flatMap((question, questionIndex) => question.searchTerms.map((term) => ({ question, questionIndex, term: normalizeQuestionText(term) })))
    .filter(({ term }) => term.length > 0 && (normalized.includes(term) || (normalized.length > 10 && term.includes(normalized))))
    .sort((left, right) => right.term.length - left.term.length || left.questionIndex - right.questionIndex)
  return matches[0]?.question ?? null
}

export function buildPriorityResearchPacket(question: PriorityResearchQuestion): PriorityResearchEvidencePacket {
  const sources = question.sourceProfileIds.map(sourceProfileForId)
  if (sources.some((source) => source === null)) throw new Error(`Question ${question.id} references an unknown source profile.`)
  return {
    contractVersion: 'ushso-priority-research-evidence-packet.v1.0.0',
    questionSetVersion: RESEARCH_QUESTION_SET_VERSION,
    questionId: question.id,
    question: question.question,
    decision: question.decision,
    matchExplanation: question.matchExplanation,
    catalog: {
      mode: ACTIVE_CATALOG.mode,
      corpusVersion: ACTIVE_CATALOG.corpusVersion,
      generation: ACTIVE_CATALOG.generation,
      recordCount: ACTIVE_CATALOG.recordCount,
      evidenceMode: 'published_offline_evidence',
    },
    sources: sources.map((source) => ({
      id: source!.id,
      familyId: source!.familyId,
      name: source!.name,
      publisher: source!.publisher,
      product: source!.product,
      coverage: source!.coverage,
      coverageLabel: source!.coverageLabel,
      coverageNote: source!.coverageNote,
      officialDiscoveryUrl: source!.officialDiscoveryUrl,
      ...(source!.catalogRecordId ? { catalogRecordId: source!.catalogRecordId } : {}),
      evidenceRefs: [...source!.evidenceRefs],
      facts: source!.facts.map((item) => ({ ...item, evidenceRefs: [...item.evidenceRefs] })),
      nextAction: source!.nextAction,
      joinLimitations: source!.joinLimitations,
      ...(source!.dictionaryUrl ? { dictionaryUrl: source!.dictionaryUrl } : {}),
      ...(source!.dictionaryLabel ? { dictionaryLabel: source!.dictionaryLabel } : {}),
      ...(source!.representativeVars ? { representativeVars: [...source!.representativeVars] } : {}),
      ...(source!.evidenceLinks ? { evidenceLinks: source!.evidenceLinks.map((link) => ({ ...link })) } : {}),
    })),
    nextAction: question.nextAction,
    limitations: [
      'This packet contains bounded catalog and registry evidence, not source payload rows.',
      'Unknown, conflicting, and untested access or schema facts remain unresolved.',
      'A named source gap is a precise routing result, not proof that the publisher product is absent.',
      'No credentials, account data, hidden telemetry, LLM output, or live publisher request is included.',
    ],
  }
}

export function validatePriorityResearchNavigator() {
  if (PRIORITY_RESEARCH_QUESTIONS.length !== 20) throw new Error('The priority research set must contain exactly 20 questions.')
  if (new Set(PRIORITY_RESEARCH_QUESTIONS.flatMap((question) => question.familyIds)).size < 8) throw new Error('The priority research set must cover at least eight source families.')
  for (const question of PRIORITY_RESEARCH_QUESTIONS) {
    if (!question.question || !question.matchExplanation || !question.decision || !question.nextAction || !question.packetFilename) throw new Error(`Question ${question.id} is missing a researcher-facing field.`)
    for (const sourceId of question.sourceProfileIds) {
      const source = sourceProfileForId(sourceId)
      if (!source || source.facts.length < 10 || !source.nextAction || !source.joinLimitations || source.evidenceRefs.length === 0) throw new Error(`Source profile ${sourceId} is incomplete.`)
      for (const item of source.facts) {
        if (!item.label || !item.value || !EVIDENCE_STATES.includes(item.state) || item.evidenceRefs.length === 0) throw new Error(`Source profile ${sourceId} has an unbound fact.`)
      }
      if (source.facts.some((item) => item.state === 'successfully_tested')) throw new Error(`Source profile ${sourceId} must not claim successfully tested payload access from documentation alone.`)
      for (const link of source.evidenceLinks ?? []) {
        if (!link.label || !link.url || !link.locator || !link.url.startsWith('https://')) throw new Error(`Source profile ${sourceId} has an unresolvable evidence link.`)
      }
      if (source.dictionaryUrl && !source.dictionaryUrl.startsWith('https://')) throw new Error(`Source profile ${sourceId} has an unresolvable dictionary link.`)
    }
  }
  return true
}

validatePriorityResearchNavigator()
