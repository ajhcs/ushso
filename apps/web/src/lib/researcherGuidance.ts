import type { DatasetFamily } from '../types/catalog'
import type { EvidenceState, ObservatoryRecord } from '../types/discovery'
import { safeExternalHttpsUrl } from './externalUrls'

export interface GuidanceField {
  label: string
  values: string[]
  evidenceState: EvidenceState | 'mixed'
  evidenceIds: string[]
}

export interface ResearcherGuidance {
  assetId: string
  observedAt: string
  reviewStatus: 'pending_external_researcher_review'
  useCard: {
    fields: GuidanceField[]
    evidenceIds: string[]
  }
  accessPlan: {
    accessClass: 'public' | 'registration' | 'application' | 'dua' | 'licensed' | 'paid' | 'unknown'
    whoQualifies: string[]
    requestProcess: Array<{ sequence: number; instruction: string; requiresHuman: boolean; expectedResult: string }>
    humanGates: string[]
    turnaround: { category: 'unknown'; statement: string }
    feeBasis: string
    delivery: string[]
    requiredInputs: string[]
    expectedArtifacts: string[]
    stopConditions: string[]
    typedFailures: Array<{ outcome: string; translateToNotFound: false }>
    evidenceIds: string[]
  }
  retrievalRecipe: {
    promotionState: 'incomplete_exact_pins'
    pins: { assetId: string; releaseId: null; distributionId: null; accessRouteId: null }
    missingPins: Array<'release_id' | 'distribution_id' | 'access_route_id'>
    steps: Array<{ sequence: number; action: string; url: string | null; instruction: string; stopConditions: string[]; executionAllowed: false }>
    expectedArtifacts: string[]
    typedFailures: Array<{ outcome: string; translateToNotFound: false }>
    evidenceIds: string[]
    boundary: { executionAllowed: false; payloadAcquisitionClaimed: false; authorizationClaimed: false }
  }
  machineReadiness: Array<{ flag: string; state: string; evidenceIds: string[]; observedAt: string }>
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function sentenceCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function allLimitations(record: ObservatoryRecord) {
  return unique([
    ...record.evidence.flatMap((item) => item.limitations),
    ...(record.variable_documentation?.limitations ?? []),
    ...record.join_compatibility.notes,
  ])
}

function matchingOrUnknown(values: string[], pattern: RegExp, unknown: string) {
  const matches = values.filter((value) => pattern.test(value))
  return matches.length > 0 ? matches : [unknown]
}

function accessClass(record: ObservatoryRecord): ResearcherGuidance['accessPlan']['accessClass'] {
  const mapping: Record<ObservatoryRecord['access']['status'], ResearcherGuidance['accessPlan']['accessClass']> = {
    public_direct: 'public',
    public_catalog: 'public',
    registration_required: 'registration',
    application_required: 'application',
    dua_required: 'dua',
    licensed_paid: 'paid',
    controlled: 'licensed',
    temporarily_unavailable: 'unknown',
    unavailable: 'unknown',
    unknown: 'unknown',
  }
  return mapping[record.access.status]
}

function accessFailures(record: ObservatoryRecord) {
  const outcomes = new Set<string>(['unresolved'])
  if (record.access.status === 'registration_required') outcomes.add('registration_required')
  if (record.access.status === 'application_required') outcomes.add('application_required')
  if (record.access.status === 'dua_required') outcomes.add('dua_required')
  if (record.access.status === 'licensed_paid') outcomes.add('payment_required')
  if (record.access.status === 'controlled') outcomes.add('authorization_required')
  if (record.access.status === 'temporarily_unavailable' || record.access.status === 'unavailable') outcomes.add('unavailable')
  if (record.access.infrastructure_state === 'blocked') outcomes.add('authorization_required')
  if (record.access.infrastructure_state === 'unreachable' || record.access.infrastructure_state === 'degraded') outcomes.add('transport_failure')
  return [...outcomes].sort().map((outcome) => ({ outcome, translateToNotFound: false as const }))
}

export function buildResearcherGuidance(dataset: DatasetFamily): ResearcherGuidance {
  const record = dataset.canonicalResult.record
  const evidenceIds = unique(record.evidence.map((item) => item.evidence_id))
  const limitations = allLimitations(record)
  const useCases = record.capabilities.use_cases.filter((item) => item.fitness === 'primary' || item.fitness === 'supporting')
  const bestFor = useCases.length > 0
    ? useCases.map((item) => `${item.label}: ${item.rationale}`)
    : ['No evidence-backed primary or supporting research use is documented in this published record.']
  const joinRequirements = dataset.joinRoutes.length > 0
    ? dataset.joinRoutes.map((route) => `${route.compatibility_state}: ${route.match_strategy}; ${route.preconditions.join(' · ') || 'no prerequisite captured'}`)
    : ['No documented join or crosswalk route is present in the pinned discovery response; this does not prove that no route exists.']
  const dataThrough = record.freshness_verification.data_through ?? 'not stated'
  const accessEvidenceIds = unique(record.access.evidence_ids)
  const documentationEvidenceIds = unique(record.variable_documentation?.evidence_ids ?? evidenceIds)
  const compatibilityEvidenceIds = unique([
    ...record.geography.evidence_ids,
    ...record.time_coverage.evidence_ids,
    ...dataset.joinRoutes.flatMap((route) => route.evidence_refs.flatMap((reference) => reference.evidence_ids)),
  ])
  const typedFailures = accessFailures(record)
  const requestProcess = record.retrieval.instructions.map((step) => ({
    sequence: step.sequence,
    instruction: step.instruction,
    requiresHuman: step.requires_human,
    expectedResult: step.expected_result,
  }))
  const stopConditions = unique([
    record.retrieval.failure_policy,
    ...record.retrieval.instructions.filter((step) => step.action === 'stop_and_report').map((step) => step.instruction),
    'Stop when source terms, authorization, identity, release, distribution, or expected artifact cannot be confirmed; retain the typed failure.',
  ])

  return {
    assetId: record.identity.asset.asset_id,
    observedAt: record.freshness_verification.metadata_observed_at,
    reviewStatus: 'pending_external_researcher_review',
    useCard: {
      fields: [
        { label: 'Best for', values: bestFor, evidenceState: useCases.length > 0 ? 'mixed' : 'unresolved', evidenceIds: unique(useCases.flatMap((item) => item.evidence_ids).concat(evidenceIds)) },
        { label: 'Not sufficient for', values: ['This metadata does not establish row completeness, schema completeness, access authorization, analytical fitness, or an analytical result.'], evidenceState: 'unresolved', evidenceIds },
        { label: 'Key analytic cautions', values: limitations.length > 0 ? limitations : ['No source-specific analytic caution is captured; analytical fitness remains unresolved.'], evidenceState: limitations.length > 0 ? 'mixed' : 'unresolved', evidenceIds },
        { label: 'Typical unit', values: record.unit_of_analysis.length > 0 ? record.unit_of_analysis.map(sentenceCase) : ['Unit of observation is unresolved.'], evidenceState: record.unit_of_analysis.length > 0 ? 'source_asserted' : 'unresolved', evidenceIds },
        { label: 'Known breaks in series', values: matchingOrUnknown(limitations, /break|series|methodolog|redesign|discontinu/i, 'No break-in-series evidence is captured; continuity is unresolved.'), evidenceState: 'unresolved', evidenceIds },
        { label: 'Update frequency and expected lag', values: [`Source-reported update frequency: ${sentenceCase(record.freshness_verification.update_frequency)}. Data through: ${dataThrough}. Expected publication lag is not captured.`], evidenceState: record.freshness_verification.update_frequency === 'unknown' ? 'unresolved' : 'source_asserted', evidenceIds },
        { label: 'Suppression and completeness', values: matchingOrUnknown(limitations, /suppress|complete|missing|coverage|disclos/i, 'Suppression and row-level completeness are not documented in the published metadata.'), evidenceState: 'unresolved', evidenceIds },
        { label: 'Identifier stability over time', values: [`Family resolution: ${sentenceCase(record.identity.family.resolution_state)}. Asset version state: ${sentenceCase(record.identity.asset.version_state)}. Stability beyond those claims is unresolved.`], evidenceState: 'mixed', evidenceIds: unique(record.identity.family.evidence_ids.concat(evidenceIds)) },
        { label: 'Source-reported, derived, and proxy measures', values: ['The published metadata does not classify measures as source-reported, derived, or proxy; do not infer a classification from field names or topic labels.'], evidenceState: 'unresolved', evidenceIds: documentationEvidenceIds },
        { label: 'Compatible geography, time, and grain', values: [`Published metadata states geography ${dataset.geographicApplicability}, time ${dataset.availableYears}, and grain ${dataset.reportingUnit}. Compatibility beyond the stated coverage remains evidence-dependent.`], evidenceState: 'mixed', evidenceIds: compatibilityEvidenceIds },
        { label: 'Join and crosswalk requirements', values: joinRequirements, evidenceState: dataset.joinRoutes.length > 0 ? 'mixed' : 'unresolved', evidenceIds: compatibilityEvidenceIds.length > 0 ? compatibilityEvidenceIds : evidenceIds },
      ],
      evidenceIds,
    },
    accessPlan: {
      accessClass: accessClass(record),
      whoQualifies: record.access.requirements.length > 0
        ? record.access.requirements
        : ['Eligibility is not stated in the published metadata; confirm the authoritative source’s current terms.'],
      requestProcess,
      humanGates: unique([
        ...record.retrieval.instructions.filter((step) => step.requires_human).map((step) => `Step ${step.sequence}: ${step.instruction}`),
        ...record.access.requirements,
      ]),
      turnaround: { category: 'unknown', statement: 'No evidenced turnaround category or point estimate is captured.' },
      feeBasis: record.access.status === 'licensed_paid'
        ? 'A paid or licensed access class is reported; the fee basis is not captured.'
        : 'No fee basis is captured; do not infer that access is free.',
      delivery: record.access.mechanisms.length > 0 ? record.access.mechanisms : ['Delivery mechanism is unresolved.'],
      requiredInputs: record.access.requirements.length > 0 ? record.access.requirements : ['No source-specific inputs captured; confirm current source requirements.'],
      expectedArtifacts: record.retrieval.expected_artifacts.length > 0 ? record.retrieval.expected_artifacts : ['Expected artifact is unresolved.'],
      stopConditions,
      typedFailures,
      evidenceIds: accessEvidenceIds.length > 0 ? accessEvidenceIds : evidenceIds,
    },
    retrievalRecipe: {
      promotionState: 'incomplete_exact_pins',
      pins: { assetId: record.identity.asset.asset_id, releaseId: null, distributionId: null, accessRouteId: null },
      missingPins: ['release_id', 'distribution_id', 'access_route_id'],
      steps: record.retrieval.instructions.map((step) => ({
        sequence: step.sequence,
        action: step.action,
        url: safeExternalHttpsUrl(step.url),
        instruction: step.instruction,
        stopConditions,
        executionAllowed: false,
      })),
      expectedArtifacts: record.retrieval.expected_artifacts.length > 0 ? record.retrieval.expected_artifacts : ['Expected artifact is unresolved.'],
      typedFailures,
      evidenceIds,
      boundary: { executionAllowed: false, payloadAcquisitionClaimed: false, authorizationClaimed: false },
    },
    machineReadiness: [
      { flag: 'interface', state: sentenceCase(record.retrieval.preferred_interface), evidenceIds, observedAt: record.freshness_verification.metadata_observed_at },
      { flag: 'authentication', state: record.access.status === 'public_direct' ? 'Not reported as required' : 'Required or unresolved', evidenceIds: accessEvidenceIds, observedAt: record.freshness_verification.metadata_observed_at },
      { flag: 'schema', state: record.variable_documentation?.status ?? 'Not captured', evidenceIds: documentationEvidenceIds, observedAt: record.freshness_verification.metadata_observed_at },
      { flag: 'pagination', state: 'Unknown', evidenceIds, observedAt: record.freshness_verification.metadata_observed_at },
      { flag: 'recipe', state: record.retrieval.instructions.length > 0 ? 'Candidate; exact release/distribution/access-route pins missing' : 'None', evidenceIds, observedAt: record.freshness_verification.metadata_observed_at },
      { flag: 'verification', state: sentenceCase(record.freshness_verification.verification_status), evidenceIds, observedAt: record.freshness_verification.metadata_observed_at },
      { flag: 'join evidence', state: sentenceCase(record.join_compatibility.state), evidenceIds: compatibilityEvidenceIds, observedAt: record.freshness_verification.metadata_observed_at },
    ],
  }
}
