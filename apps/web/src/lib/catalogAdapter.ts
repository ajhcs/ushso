import { buildFacetSections } from '../data/facets'
import type {
  AccessOption,
  CatalogSearchResponse,
  DatasetFamily,
  DatasetRecord,
  Relevance,
  Relationship,
} from '../types/catalog'
import type { DiscoveryResult, DiscoveryResultItem, ObservatoryRecord, ObservatoryRetrievalStep } from '../types/discovery'

function sentenceCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function recordIdForRoute(recordId: string) {
  return recordId.replace(/^obs:asset:/, '')
}

function presentationRelevance(result: DiscoveryResultItem): Relevance {
  // Presentation only: canonical rank and score remain untouched and drive best-match order.
  if (result.score >= 50) return 'High'
  if (result.score >= 20) return 'Medium'
  return 'Low'
}

function relationshipLabel(record: ObservatoryRecord): Relationship {
  if (record.identity.family.resolution_state === 'exact' || record.identity.family.resolution_state === 'source_asserted') return 'Confirmed family'
  if (record.identity.family.resolution_state === 'provisional' || record.identity.family.resolution_state === 'ambiguous') return 'Possible relation'
  return 'Standalone record'
}

function timeDisplay(record: ObservatoryRecord) {
  if (record.time_coverage.state === 'rolling') return record.time_coverage.start ? `${record.time_coverage.start}–Present` : 'Rolling coverage'
  if (record.time_coverage.start && record.time_coverage.end) {
    return record.time_coverage.start === record.time_coverage.end ? record.time_coverage.start : `${record.time_coverage.start}–${record.time_coverage.end}`
  }
  return record.time_coverage.start ?? record.time_coverage.end ?? 'Coverage unresolved'
}

function geographyDisplay(record: ObservatoryRecord) {
  const jurisdictions = record.geography.jurisdictions
  if (record.geography.coverage_level === 'national' || jurisdictions.includes('US')) return 'National; filterability depends on source fields'
  if (jurisdictions.length === 1 && jurisdictions[0] === 'US-PA') return 'PA-only'
  return jurisdictions.map((value) => value.replace(/^US-/, '')).join(', ') || 'Geography unresolved'
}

function accessKind(step: ObservatoryRetrievalStep): AccessOption['kind'] {
  if (step.action === 'call_api') return 'api'
  if (step.action === 'download') return 'download'
  if (['submit_request', 'accept_license', 'authenticate', 'contact_owner', 'stop_and_report'].includes(step.action)) return 'request'
  return 'report'
}

function accessLabel(step: ObservatoryRetrievalStep) {
  const labels: Record<ObservatoryRetrievalStep['action'], string> = {
    open: 'Open authoritative source',
    download: 'Download data',
    call_api: 'Open API',
    submit_request: 'Request access',
    accept_license: 'Review license',
    authenticate: 'Sign in at source',
    inspect_metadata: 'Review source metadata',
    contact_owner: 'Contact source owner',
    stop_and_report: 'Access unresolved',
  }
  return labels[step.action]
}

function accessOptions(record: ObservatoryRecord): AccessOption[] {
  return record.retrieval.instructions.map((step) => ({
    id: `${record.record_id}:${step.sequence}`,
    label: accessLabel(step),
    description: step.instruction,
    kind: accessKind(step),
    ...(step.url ? { href: step.url } : {}),
    requirements: [...record.access.requirements],
  }))
}

function dataCategoryFacets(record: ObservatoryRecord) {
  const joined = record.capabilities.topics.map((topic) => `${topic.id} ${topic.label}`).join(' ').toLowerCase()
  const values = new Set<string>()
  if (joined.includes('financial')) values.add('financial')
  if (joined.includes('utilization')) values.add('utilization')
  if (joined.includes('quality')) values.add('quality')
  if (joined.includes('ownership')) values.add('ownership')
  if (joined.includes('workforce') || joined.includes('staff')) values.add('workforce')
  if (joined.includes('cost') || joined.includes('price') || joined.includes('charge')) values.add('costs-charges')
  if (joined.includes('capacity') || joined.includes('provider') || joined.includes('facility')) values.add('hospital-characteristics')
  return [...values]
}

function geographyFacets(record: ObservatoryRecord) {
  const values = new Set<string>()
  if (record.geography.jurisdictions.includes('US-PA')) values.add('pennsylvania')
  if (record.geography.jurisdictions.includes('US')) {
    values.add('national')
    values.add('other-states')
  }
  return [...values]
}

function accessFacets(record: ObservatoryRecord) {
  const values = new Set<string>()
  const status = record.access.status
  if (status === 'public_catalog') values.add('public-report')
  if (status === 'public_direct' || record.access.mechanisms.some((value) => ['api', 'bulk_download', 'web_download'].includes(value))) values.add('open-data-api')
  if (status === 'registration_required' || status === 'application_required') values.add('application-required')
  if (status === 'licensed_paid' || record.access.requirements.includes('payment') || record.access.requirements.includes('license_agreement')) values.add('fee-license')
  if (status === 'dua_required' || record.access.requirements.includes('data_use_agreement')) values.add('data-use-agreement')
  if (status === 'unavailable' || status === 'temporarily_unavailable') values.add('unavailable')
  if (status === 'unknown') values.add('access-unresolved')
  return [...values]
}

function unitFacets(record: ObservatoryRecord) {
  const values = new Set<string>()
  record.unit_of_analysis.forEach((unit) => {
    if (unit === 'hospital' || unit === 'facility') values.add('hospital')
    if (unit === 'health_system') values.add('health-system')
    if (unit === 'provider') values.add('provider')
    if (unit === 'facility' && record.time_coverage.temporal_granularity !== 'not_applicable') values.add('facility-period')
  })
  return [...values]
}

function resultToView(result: DiscoveryResultItem, response: DiscoveryResult, familyCount: number): DatasetRecord {
  const { record } = result
  const joinRoutes = response.join_routes.filter((route) => route.from_record_id === result.record_id || route.to_record_id === result.record_id)
  const familyStatus = familyCount > 1 ? 'Family' : 'Single-record family'
  const units = record.unit_of_analysis.map(sentenceCase)
  const topics = record.capabilities.topics.map((topic) => topic.label)
  const latestRelease = record.freshness_verification.data_through
    ? `${record.freshness_verification.data_through} (${sentenceCase(record.freshness_verification.verification_status)})`
    : sentenceCase(record.freshness_verification.verification_status)
  const id = recordIdForRoute(record.record_id)

  return {
    id,
    rank: result.rank,
    title: record.title,
    description: record.description,
    familyStatus,
    familySiblingCount: Math.max(0, familyCount - 1),
    relevance: response.query.filters.mode === 'catalog_browse' ? 'Browse' : presentationRelevance(result),
    relationship: relationshipLabel(record),
    whyMatched: result.relevance.why_relevant[0] ?? 'Matched canonical discovery metadata',
    recordType: sentenceCase(record.identity.asset.asset_type),
    geographicApplicability: geographyDisplay(record),
    reportingUnit: units.join(', ') || 'Unit unresolved',
    populationFacilityScope: units.join(', ') || 'Scope unresolved',
    availableYears: timeDisplay(record),
    latestVerifiedRelease: latestRelease,
    variablesCodebook: record.retrieval.expected_artifacts.join(' · ') || 'Documentation unresolved',
    accessOptions: accessOptions(record),
    categories: topics,
    sourceName: record.identity.source.name,
    sourceUrl: record.authoritative_url,
    detailsUrl: `/datasets/${encodeURIComponent(id)}`,
    facetValues: {
      'data-category': dataCategoryFacets(record),
      geography: geographyFacets(record),
      access: accessFacets(record),
      'reporting-unit': unitFacets(record),
    },
    parentFamilyId: record.identity.family.family_id,
    canonicalResult: result,
    joinRoutes,
  }
}

export function adaptDiscoveryResponse(response: DiscoveryResult): CatalogSearchResponse {
  const familyCounts = response.results.reduce<Map<string, number>>((counts, result) => {
    const familyId = result.record.identity.family.family_id
    counts.set(familyId, (counts.get(familyId) ?? 0) + 1)
    return counts
  }, new Map())
  const directSiblingCount = Number(response.query.filters.family_sibling_count)
  const records = response.results.map((result) => {
    const returnedFamilyCount = familyCounts.get(result.record.identity.family.family_id) ?? 1
    const familyCount = Number.isInteger(directSiblingCount) && directSiblingCount >= 0 ? directSiblingCount + 1 : returnedFamilyCount
    return resultToView(result, response, familyCount)
  })
  const byFamily = new Map<string, DatasetFamily>()
  records.forEach((record) => {
    const familyId = record.canonicalResult.record.identity.family.family_id
    if (!byFamily.has(familyId)) byFamily.set(familyId, record)
  })
  const sources = new Set(response.results.map((result) => result.record.identity.source.source_id))
  return {
    query: response.query.question,
    totals: { families: byFamily.size, records: records.length, sources: sources.size },
    families: [...byFamily.values()],
    records,
    facets: buildFacetSections(records),
    canonicalResponse: response,
  }
}

export function findDatasetInResponse(response: DiscoveryResult, id: string) {
  const adapted = adaptDiscoveryResponse(response)
  return adapted.records.find((item) => item.id === id) ?? adapted.families.find((item) => item.id === id)
}
