import type { DiscoveryResult, ObservatoryRecord, ObservatoryVariable } from '../types/discovery'

interface LiveVerificationVariable extends Omit<ObservatoryVariable, 'evidence_state' | 'evidence_ids'> {}

interface LiveVerificationRecord {
  record_id: string
  authoritative_url: string
  additional_evidence_urls?: string[]
  verification_status: 'current_verified'
  verification_method: 'first_party_live'
  http_status: 200
  claim: string
  variable_documentation: {
    status: 'documented' | 'partial' | 'not_captured' | 'unavailable' | 'unknown'
    summary: string | null
    variable_count: number | null
    variables: LiveVerificationVariable[]
    codebook: { title: string; url: string } | null
    limitations: string[]
  }
}
interface LiveVerificationReceipt {
  schema_version: 'observatory-live-verification.v1.0.0'
  receipt_id: string
  observed_at: string
  scope: {
    retrieval_package: string
    response: string
    record_count: number
    boundary: string
  }
  records: LiveVerificationRecord[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function fail(message: string): never {
  throw new Error(`Live verification overlay rejected: ${message}`)
}

function validateVariable(value: unknown): asserts value is LiveVerificationVariable {
  if (!isObject(value) || typeof value.name !== 'string' || !value.name || typeof value.description !== 'string' || !value.description) {
    fail('variable definitions require a name and description')
  }
  if (value.label !== null && typeof value.label !== 'string') fail('variable label must be a string or null')
  if (value.data_type !== null && typeof value.data_type !== 'string') fail('variable data_type must be a string or null')
  if (value.unit !== null && typeof value.unit !== 'string') fail('variable unit must be a string or null')
  if (!isStringArray(value.allowed_values) && !(Array.isArray(value.allowed_values) && value.allowed_values.length === 0)) {
    fail('variable allowed_values must be a string array')
  }
}

function validateReceipt(value: unknown): asserts value is LiveVerificationReceipt {
  if (!isObject(value) || value.schema_version !== 'observatory-live-verification.v1.0.0') fail('unsupported schema version')
  if (typeof value.receipt_id !== 'string' || !value.receipt_id || typeof value.observed_at !== 'string' || !value.observed_at) fail('receipt identity or observation date is missing')
  if (!isObject(value.scope) || typeof value.scope.retrieval_package !== 'string' || typeof value.scope.response !== 'string' || typeof value.scope.boundary !== 'string' || typeof value.scope.record_count !== 'number') {
    fail('scope is incomplete')
  }
  if (!Array.isArray(value.records)) fail('records must be an array')
  for (const record of value.records) {
    if (!isObject(record) || typeof record.record_id !== 'string' || typeof record.authoritative_url !== 'string' || typeof record.claim !== 'string' || !record.claim) fail('record identity, URL, or claim is missing')
    if (record.verification_status !== 'current_verified' || record.verification_method !== 'first_party_live' || record.http_status !== 200) fail(`${record.record_id} is not a successful current first-party verification`)
    if (record.additional_evidence_urls !== undefined && !isStringArray(record.additional_evidence_urls)) fail(`${record.record_id} has invalid additional evidence URLs`)
    const documentation = record.variable_documentation
    if (!isObject(documentation) || !['documented', 'partial', 'not_captured', 'unavailable', 'unknown'].includes(String(documentation.status))) fail(`${record.record_id} has invalid variable documentation`)
    if (documentation.summary !== null && typeof documentation.summary !== 'string') fail(`${record.record_id} has an invalid variable summary`)
    if (documentation.variable_count !== null && (typeof documentation.variable_count !== 'number' || documentation.variable_count < 0)) fail(`${record.record_id} has an invalid variable count`)
    if (!Array.isArray(documentation.variables) || !isStringArray(documentation.limitations)) fail(`${record.record_id} has invalid variables or limitations`)
    if (documentation.codebook !== null && (!isObject(documentation.codebook) || typeof documentation.codebook.title !== 'string' || typeof documentation.codebook.url !== 'string')) fail(`${record.record_id} has an invalid codebook`)
    documentation.variables.forEach(validateVariable)
  }
}

function knownSourceUrls(record: ObservatoryRecord) {
  return new Set([
    record.authoritative_url,
    ...record.provenance.map((source) => source.locator),
    ...record.retrieval.instructions.map((step) => step.url),
  ].filter((value): value is string => typeof value === 'string'))
}

export function applyLiveVerificationOverlay(response: DiscoveryResult, receiptValue: unknown): DiscoveryResult {
  validateReceipt(receiptValue)
  const receipt = receiptValue
  if (receipt.scope.record_count !== receipt.records.length) fail('scope record count does not match receipt records')
  if (receipt.records.length !== response.results.length) fail('receipt does not cover every displayed record')

  const receiptByRecordId = new Map<string, LiveVerificationRecord>()
  for (const item of receipt.records) {
    if (receiptByRecordId.has(item.record_id)) fail(`duplicate receipt entry for ${item.record_id}`)
    receiptByRecordId.set(item.record_id, item)
  }
  const responseRecordIds = new Set(response.results.map((item) => item.record_id))
  if ([...receiptByRecordId].some(([recordId]) => !responseRecordIds.has(recordId))) fail('receipt contains a record outside the response')

  const merged = structuredClone(response)
  for (const result of merged.results) {
    const overlay = receiptByRecordId.get(result.record_id)
    if (!overlay) fail(`missing receipt entry for ${result.record_id}`)
    if (!knownSourceUrls(result.record).has(overlay.authoritative_url)) fail(`${result.record_id} URL does not exactly match a known backend source URL`)

    const evidenceId = `evidence:${receipt.receipt_id}:${result.record_id}`
    const locators = [overlay.authoritative_url, ...(overlay.additional_evidence_urls ?? [])]
    const provenanceIds = locators.map((locator, index) => {
      const provenanceId = `provenance:${receipt.receipt_id}:${result.record_id}:${index + 1}`
      result.record.provenance.push({
        provenance_id: provenanceId,
        kind: index === 0 ? 'first_party_page' : 'documentation',
        locator,
        observed_at: receipt.observed_at,
        capture_state: 'locator_only',
        content_sha256: null,
      })
      return provenanceId
    })
    result.record.evidence.push({
      evidence_id: evidenceId,
      claim: overlay.claim,
      state: 'verified_first_party',
      provenance_ids: provenanceIds,
      limitations: [...overlay.variable_documentation.limitations, receipt.scope.boundary],
    })
    result.record.freshness_verification = {
      ...result.record.freshness_verification,
      metadata_observed_at: receipt.observed_at,
      verification_status: overlay.verification_status,
      verification_method: overlay.verification_method,
    }
    result.record.variable_documentation = {
      ...structuredClone(overlay.variable_documentation),
      variables: overlay.variable_documentation.variables.map((variable) => ({
        ...structuredClone(variable),
        evidence_state: 'verified_first_party',
        evidence_ids: [evidenceId],
      })),
      evidence_state: 'verified_first_party',
      evidence_ids: [evidenceId],
    }
  }
  return merged
}
