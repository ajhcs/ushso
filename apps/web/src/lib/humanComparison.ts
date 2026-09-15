export const HUMAN_COMPARISON_DIMENSIONS = ['role', 'geography', 'grain', 'time', 'variables_schema', 'access', 'freshness', 'join_compatibility'] as const
export type HumanComparisonDimension = typeof HUMAN_COMPARISON_DIMENSIONS[number]

export const PRICE_TYPE_LABELS = {
  negotiated_rate: 'Negotiated rate between a hospital and a payer. This is not a patient bill.',
  allowed_amount: 'Allowed amount under a plan contract. This is not a patient bill.',
  gross_charge: 'Gross charge before any payer or cash discount. This is not a patient bill.',
  cash_price: 'Cash or self-pay price published by the hospital. This is not a negotiated rate or a guaranteed patient bill.',
} as const

export const HCRIS_HOSPITAL_COST_REPORT_ID = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17'
export const PHC4_PUBLIC_FINANCIAL_REPORTS_ID = 'obs:asset:pa-phc4-public-financial-reports'
export const HOSPITAL_MRF_EXAMPLE_ID = 'obs:asset:hospital-mrf-example'
export const PAYER_MRF_EXAMPLE_ID = 'obs:asset:payer-mrf-example'
export const HCRIS_PHC4_DEFINITION_CAVEAT = 'HCRIS Worksheet G-3 cost-report definitions are not PHC4 public financial-statement definitions.'

const HCRIS = {
  record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
  reporting_definition: 'Medicare hospital cost-report worksheets filed by CCN for a provider cost-reporting period. Not Pennsylvania PHC4 financial-statement reporting.',
  geography: 'United States Medicare-certified hospitals; not limited to Pennsylvania.',
  grain: 'facility/report/year (CMS cost report / CCN / fiscal year). Inferred catalog unit tags are not this claim.',
  access: 'Public CMS catalog documentation. Catalog membership is not payload access.',
  time: 'Provider cost-reporting fiscal period, not PHC4 annual public financial-report vintage.',
  variables_schema: 'Accepted HCRIS Worksheet G-3 example-packet wire mappings only. Not a complete HCRIS schema and not PHC4 statement lines.',
  freshness: 'current first-party catalog metadata as of the selected generation',
  authority: 'CMS hospital cost-report catalog metadata',
  join_compatibility: 'No automatic CCN=NPI or HCRIS-to-PHC4 identity merge.',
} as const

const PHC4 = {
  record_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
  reporting_definition: 'Pennsylvania Health Care Cost Containment Council public hospital and health-system financial reports. Not CMS HCRIS Worksheet G-3 cost-report definitions.',
  geography: 'Pennsylvania public financial reporting; not the national Medicare cost-report universe.',
  grain: 'hospital/health-system public financial report. Public report visibility is not PHC4 custom record-level access.',
  access: 'Public PHC4 report pages. Custom record-level PHC4 files remain a separate restricted request path.',
  time: 'PHC4 public financial-report vintage, not a CMS cost-reporting fiscal period.',
  variables_schema: 'PHC4 public financial-statement categories. Not HCRIS Worksheet G-3 NET_PATIENT_REVENUE wire mappings.',
  freshness: 'documented public-report locator only; payload completeness unknown',
  authority: 'PHC4 public financial-report catalog metadata',
  join_compatibility: 'No automatic CCN=NPI or HCRIS-to-PHC4 identity merge.',
} as const

const DOCUMENTED: Record<string, typeof HCRIS | typeof PHC4> = {
  [HCRIS.record_id]: HCRIS,
  [PHC4.record_id]: PHC4,
}

export interface ComparisonSource {
  record_id: string
  title: string
  evidence?: Array<{ evidence_id: string }>
}

export interface HumanComparisonValue {
  asset_id: string
  metadata_value: string | null
  state: 'known' | 'unknown'
}

export interface HumanComparisonDimensionRow {
  dimension: HumanComparisonDimension
  state: 'comparable' | 'incomparable' | 'unknown'
  values: HumanComparisonValue[]
  explanation: string
}

export interface HumanComparisonResult {
  asset_ids: string[]
  dimensions: HumanComparisonDimensionRow[]
  ranking_performed: false
  source_values_compared: false
  overall_quality_score: null
  caveats: string[]
}

export function documentedComparisonProfile(recordId: string) {
  return DOCUMENTED[recordId] ?? null
}

export function comparisonFact(record: { record_id: string }, dimension: string): { metadata_value: string | null; state: 'known' | 'unknown' } {
  const documented = documentedComparisonProfile(record.record_id)
  if (!documented) return { metadata_value: null, state: 'unknown' }
  switch (dimension) {
    case 'access': return { metadata_value: documented.access, state: 'known' }
    case 'time': return { metadata_value: documented.time, state: 'known' }
    case 'grain': return { metadata_value: documented.grain, state: 'known' }
    case 'variables_schema': return { metadata_value: documented.variables_schema, state: 'known' }
    case 'geography': return { metadata_value: documented.geography, state: 'known' }
    case 'authority': return { metadata_value: documented.authority, state: 'known' }
    case 'freshness': return { metadata_value: documented.freshness, state: 'known' }
    case 'join_compatibility': return { metadata_value: documented.join_compatibility, state: 'known' }
    case 'role': return { metadata_value: documented.reporting_definition, state: 'known' }
    default: return { metadata_value: null, state: 'unknown' }
  }
}

export function comparisonDimensionState(values: Array<{ state: string; metadata_value: string | null }>) {
  if (values.some((value) => value.state !== 'known' || value.metadata_value == null)) return 'unknown' as const
  const texts = [...new Set(values.map((value) => value.metadata_value))]
  if (texts.length === 1) return 'comparable' as const
  return 'incomparable' as const
}

export function comparisonExplanation(dimension: string, values: Array<{ state: string; metadata_value: string | null }>, state: 'comparable' | 'incomparable' | 'unknown') {
  if (state === 'incomparable') {
    return 'These assets use different reporting definitions. Populated dimension values are documented metadata, not a generic complete comparison and not a ranking of source values.'
  }
  if (state === 'unknown') {
    return 'At least one requested comparison dimension remains unknown. Envelope construction is not comparison completeness.'
  }
  return 'Indexed and documented metadata for this dimension is comparable. Unknown values stay unknown and no source values or analytical rankings are produced.'
}

export function compareHumanSources(sources: ComparisonSource[], dimensions: readonly HumanComparisonDimension[] = HUMAN_COMPARISON_DIMENSIONS): HumanComparisonResult {
  if (sources.length < 2 || sources.length > 5) {
    throw new Error('compare_human_sources_requires_two_to_five')
  }
  const rows = dimensions.map((dimension) => {
    const values = sources.map((source) => {
      const overlay = comparisonFact(source, dimension)
      return {
        asset_id: source.record_id,
        metadata_value: overlay.metadata_value,
        state: overlay.metadata_value == null ? 'unknown' as const : overlay.state,
      }
    })
    const state = comparisonDimensionState(values)
    return {
      dimension,
      state,
      values,
      explanation: comparisonExplanation(dimension, values, state),
    }
  })
  const caveats = []
  const ids = new Set(sources.map((source) => source.record_id))
  if (ids.has(HCRIS_HOSPITAL_COST_REPORT_ID) && ids.has(PHC4_PUBLIC_FINANCIAL_REPORTS_ID)) {
    caveats.push(HCRIS_PHC4_DEFINITION_CAVEAT)
    caveats.push('An unresolved HCRIS/PHC4 join is not a confirmed merge. CCN and NPI are never interchangeable.')
  }
  if (ids.has(HOSPITAL_MRF_EXAMPLE_ID) || ids.has(PAYER_MRF_EXAMPLE_ID)) {
    caveats.push(PRICE_TYPE_LABELS.negotiated_rate)
    caveats.push('Gross, cash, negotiated and allowed-amount remain distinct measures. None of these is a patient bill.')
  }
  caveats.push('This comparison uses documented metadata dimensions from compare_assets. Envelope construction is not comparison completeness. No numeric overall quality score is assigned.')
  return {
    asset_ids: sources.map((source) => source.record_id),
    dimensions: rows,
    ranking_performed: false,
    source_values_compared: false,
    overall_quality_score: null,
    caveats,
  }
}

export function documentedSourceTitle(recordId: string) {
  const profile = documentedComparisonProfile(recordId)
  if (recordId === HCRIS_HOSPITAL_COST_REPORT_ID) return 'CMS Hospital Provider Cost Report'
  if (recordId === PHC4_PUBLIC_FINANCIAL_REPORTS_ID) return 'PHC4 Public Hospital Financial Reports'
  if (recordId === HOSPITAL_MRF_EXAMPLE_ID) return 'Hospital machine-readable file example'
  if (recordId === PAYER_MRF_EXAMPLE_ID) return 'Payer in-network negotiated-rate file example'
  return profile?.authority ?? recordId
}

export function whyPairMayNotJoin(fromId: string, toId: string) {
  if ((fromId === HCRIS_HOSPITAL_COST_REPORT_ID && toId === PHC4_PUBLIC_FINANCIAL_REPORTS_ID) || (fromId === PHC4_PUBLIC_FINANCIAL_REPORTS_ID && toId === HCRIS_HOSPITAL_COST_REPORT_ID)) {
    return 'HCRIS and PHC4 use different reporting definitions, universes and periods. No automatic CCN=NPI or HCRIS-to-PHC4 identity merge is available. An unresolved join is not a confirmed merge.'
  }
  if ((fromId === HOSPITAL_MRF_EXAMPLE_ID && toId === PAYER_MRF_EXAMPLE_ID) || (fromId === PAYER_MRF_EXAMPLE_ID && toId === HOSPITAL_MRF_EXAMPLE_ID)) {
    return 'Hospital and payer machine-readable files publish different price types. Negotiated rates are not patient bills. Gross, cash, negotiated and allowed-amount remain distinct measures.'
  }
  return 'The selected pair has no documented join route in this comparison. Unknown compatibility stays unknown.'
}

export function plannerCompilationImplied(source: string) {
  return /plan compilation occurred|compiled research plan is ready|plan_research is enabled/i.test(source)
}
