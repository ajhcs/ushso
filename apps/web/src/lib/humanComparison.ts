import {
  comparisonDimensionState,
  comparisonExplanation,
  comparisonFact,
  documentedComparisonProfile,
  HCRIS_PHC4_DEFINITION_CAVEAT,
} from '../../../../packages/registry/comparison-dimensions.mjs'

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

function asRecord(source: ComparisonSource) {
  return { record_id: source.record_id, evidence: source.evidence ?? [] }
}

export function compareHumanSources(sources: ComparisonSource[], dimensions: readonly HumanComparisonDimension[] = HUMAN_COMPARISON_DIMENSIONS): HumanComparisonResult {
  if (sources.length < 2 || sources.length > 5) {
    throw new Error('compare_human_sources_requires_two_to_five')
  }
  const rows = dimensions.map((dimension) => {
    const values = sources.map((source) => {
      const overlay = comparisonFact(asRecord(source), dimension)
      return {
        asset_id: source.record_id,
        metadata_value: overlay.metadata_value,
        state: overlay.metadata_value == null ? 'unknown' as const : overlay.state === 'known' ? 'known' as const : 'unknown' as const,
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
