import { buildFacetSections, normalizeFacetValue } from '../data/facets'
import type {
  AccessOption,
  CatalogSearchResponse,
  DatasetFamily,
  DatasetRecord,
  DatasetVariableDetails,
  DatasetVerification,
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

function grainDisplay(record: ObservatoryRecord) {
  const units = record.unit_of_analysis.map(sentenceCase).filter(Boolean)
  const granularity = record.time_coverage.temporal_granularity
  const grain = units.join(', ') || 'Unit unresolved'
  if (granularity && granularity !== 'unknown' && granularity !== 'not_applicable') {
    return `${grain} · ${sentenceCase(granularity)}`
  }
  return grain
}

const ACCESS_STATUS_LABELS: Record<ObservatoryRecord['access']['status'], string> = {
  public_direct: 'Public direct',
  public_catalog: 'Public catalog',
  registration_required: 'Registration required',
  application_required: 'Application required',
  dua_required: 'Data-use agreement required',
  licensed_paid: 'Licensed / paid',
  controlled: 'Controlled access',
  temporarily_unavailable: 'Temporarily unavailable',
  unavailable: 'Unavailable',
  unknown: 'Access unresolved',
}

function accessStatusLabel(record: ObservatoryRecord) {
  return ACCESS_STATUS_LABELS[record.access.status] ?? sentenceCase(record.access.status)
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
  return record.retrieval.instructions.slice(0, 2).map((step) => ({
    id: `${record.record_id}:${step.sequence}`,
    label: accessLabel(step),
    description: step.instruction,
    kind: accessKind(step),
    ...(step.url ? { href: step.url } : {}),
    requirements: [...record.access.requirements],
  }))
}

function verificationDetails(record: ObservatoryRecord): DatasetVerification {
  const provenanceById = new Map(record.provenance.map((source) => [source.provenance_id, source]))
  const evidence = record.evidence.map((item) => ({
    evidenceId: item.evidence_id,
    claim: item.claim,
    state: item.state,
    limitations: [...item.limitations],
    sources: item.provenance_ids.flatMap((provenanceId) => {
      const source = provenanceById.get(provenanceId)
      if (!source) return []
      return [{
        provenanceId: source.provenance_id,
        kind: source.kind,
        locator: source.locator,
        observedAt: source.observed_at,
        captureState: source.capture_state,
        contentSha256: source.content_sha256,
      }]
    }),
  }))
  const freshness = record.freshness_verification
  return {
    status: freshness.verification_status,
    method: freshness.verification_method,
    metadataObservedAt: freshness.metadata_observed_at,
    dataThrough: freshness.data_through,
    nextReviewDue: freshness.next_review_due,
    liveVerified: freshness.verification_status === 'current_verified' && freshness.verification_method === 'first_party_live',
    evidence,
  }
}

function variableDetails(record: ObservatoryRecord): DatasetVariableDetails {
  const documentation = record.variable_documentation
  const relatedLimitations = record.evidence
    .flatMap((item) => item.limitations)
    .filter((limitation) => /variable|field|column|codebook|data dictionary/i.test(limitation))
  const evidenceIds = new Set(documentation?.evidence_ids ?? [])
  record.capabilities.topics.forEach((topic) => topic.evidence_ids.forEach((id) => evidenceIds.add(id)))
  record.capabilities.use_cases.forEach((useCase) => useCase.evidence_ids.forEach((id) => evidenceIds.add(id)))

  return {
    status: documentation?.status ?? 'not_captured',
    summary: documentation?.summary ?? relatedLimitations[0] ?? null,
    variableCount: documentation?.variable_count ?? null,
    variables: documentation ? structuredClone(documentation.variables) : [],
    codebook: documentation?.codebook ? { ...documentation.codebook } : null,
    unitsOfAnalysis: [...record.unit_of_analysis],
    topics: structuredClone(record.capabilities.topics),
    useCases: structuredClone(record.capabilities.use_cases),
    expectedArtifacts: [...record.retrieval.expected_artifacts],
    evidenceState: documentation?.evidence_state ?? 'unresolved',
    evidenceIds: [...evidenceIds],
    limitations: documentation ? [...documentation.limitations] : relatedLimitations,
  }
}

function dataCategoryFacets(record: ObservatoryRecord) {
  return [...new Set(record.capabilities.topics
    .map((topic) => normalizeFacetValue(topic.id || topic.label))
    .filter(Boolean))]
}

function geographyFacets(record: ObservatoryRecord) {
  const values = new Set<string>()
  for (const jurisdiction of record.geography.jurisdictions) {
    if (jurisdiction === 'US-PA') values.add('pennsylvania')
    else if (jurisdiction === 'US') {
      values.add('national')
      values.add('other-states')
    } else {
      values.add(normalizeFacetValue(jurisdiction))
    }
  }
  return values.size > 0 ? [...values] : ['unknown']
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
  const values = new Set(record.unit_of_analysis.map(normalizeFacetValue).filter(Boolean))
  if (values.has('facility') && record.time_coverage.temporal_granularity !== 'not_applicable') values.add('facility-period')
  return values.size > 0 ? [...values] : ['unknown']
}

function yearFacets(record: ObservatoryRecord) {
  const start = Number(record.time_coverage.start?.match(/^\d{4}/)?.[0])
  const end = Number(record.time_coverage.end?.match(/^\d{4}/)?.[0])
  if (Number.isInteger(start) && Number.isInteger(end) && end >= start && end - start <= 200) {
    return Array.from({ length: end - start + 1 }, (_, index) => String(start + index))
  }
  const years = [...new Set([start, end].filter(Number.isInteger).map(String))]
  return years.length > 0 ? years : ['unknown']
}

function variableDocumentationFacets(record: ObservatoryRecord) {
  const documentation = record.variable_documentation
  if (documentation?.codebook) return ['codebook-linked']
  if (documentation && documentation.status !== 'not_captured') return [normalizeFacetValue(documentation.status)]
  return ['not-documented']
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
  const verification = verificationDetails(record)
  const variables = variableDetails(record)
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
    recordType: sentenceCase(record.identity.asset.asset_type),
    geographicApplicability: geographyDisplay(record),
    grain: grainDisplay(record),
    reportingUnit: units.join(', ') || 'Unit unresolved',
    accessStatusLabel: accessStatusLabel(record),
    populationFacilityScope: units.join(', ') || 'Scope unresolved',
    availableYears: timeDisplay(record),
    latestVerifiedRelease: latestRelease,
    variablesCodebook: variables.summary ?? variables.expectedArtifacts.join(' · '),
    verification,
    variableDetails: variables,
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
      years: yearFacets(record),
      'variables-codebook': variableDocumentationFacets(record),
      'record-type': [normalizeFacetValue(record.identity.asset.asset_type)],
      source: [normalizeFacetValue(record.identity.source.source_id)],
      verification: [normalizeFacetValue(record.freshness_verification.verification_status)],
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
