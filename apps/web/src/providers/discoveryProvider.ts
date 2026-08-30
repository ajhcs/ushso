import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import type { DiscoveryQuery, DiscoveryResult } from '../types/discovery'

export type DiscoveryProviderKind = 'fixture' | 'api'
export type DiscoveryProviderPromotionState = 'accepted' | 'unpromoted' | 'remote'

export interface DiscoveryRequestOptions {
  signal?: AbortSignal
}

export interface DiscoveryProvider {
  readonly kind: DiscoveryProviderKind
  readonly promotionState: DiscoveryProviderPromotionState
  discover(query: DiscoveryQuery, options?: DiscoveryRequestOptions): Promise<DiscoveryResult>
  browse(options?: DiscoveryRequestOptions): Promise<DiscoveryResult>
  dataset(id: string, options?: DiscoveryRequestOptions): Promise<DiscoveryResult>
}

export class DiscoveryProviderError extends Error {
  constructor(readonly code: 'aborted' | 'fixture_query_unavailable' | 'record_not_found' | 'http_error' | 'invalid_contract', message: string) {
    super(message)
    this.name = 'DiscoveryProviderError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

const evidenceStates = ['verified_first_party', 'source_asserted', 'inferred', 'unresolved', 'unavailable'] as const

function hasExplicitVerification(value: Record<string, unknown>) {
  const freshness = value.freshness_verification
  if (!isObject(freshness) || !isNonEmptyString(freshness.metadata_observed_at)) return false
  if (freshness.data_through !== null && typeof freshness.data_through !== 'string') return false
  if (freshness.next_review_due !== null && typeof freshness.next_review_due !== 'string') return false
  if (!['current_verified', 'stale', 'not_live_verified', 'unknown'].includes(String(freshness.verification_status))) return false
  if (!['first_party_live', 'captured_evidence', 'offline_fixture', 'unknown'].includes(String(freshness.verification_method))) return false
  if (!Array.isArray(value.provenance) || value.provenance.length === 0 || !Array.isArray(value.evidence) || value.evidence.length === 0) return false
  const provenanceIds = new Set<string>()
  for (const source of value.provenance) {
    if (!isObject(source) || !isNonEmptyString(source.provenance_id) || !isNonEmptyString(source.locator) || !isNonEmptyString(source.observed_at)) return false
    if (!['first_party_page', 'catalog_metadata', 'documentation', 'fixture_note', 'other'].includes(String(source.kind))) return false
    if (!['captured_hashed', 'fixture_only', 'locator_only', 'unavailable'].includes(String(source.capture_state))) return false
    if (source.content_sha256 !== null && typeof source.content_sha256 !== 'string') return false
    provenanceIds.add(source.provenance_id)
  }
  for (const evidence of value.evidence) {
    if (!isObject(evidence) || !isNonEmptyString(evidence.evidence_id) || !isNonEmptyString(evidence.claim)) return false
    if (!evidenceStates.includes(String(evidence.state) as (typeof evidenceStates)[number])) return false
    if (!isStringArray(evidence.provenance_ids) || evidence.provenance_ids.length === 0 || !isStringArray(evidence.limitations)) return false
    if (!evidence.provenance_ids.every((id) => provenanceIds.has(id))) return false
  }
  return true
}

function isVariableDocumentation(value: unknown) {
  if (!isObject(value)) return false
  if (!['documented', 'partial', 'not_captured', 'unavailable', 'unknown'].includes(String(value.status))) return false
  if (value.summary !== null && typeof value.summary !== 'string') return false
  if (value.variable_count !== null && (typeof value.variable_count !== 'number' || value.variable_count < 0)) return false
  if (!Array.isArray(value.variables) || !isStringArray(value.evidence_ids) || !isStringArray(value.limitations)) return false
  if (!evidenceStates.includes(String(value.evidence_state) as (typeof evidenceStates)[number])) return false
  if (value.codebook !== null && (!isObject(value.codebook) || typeof value.codebook.title !== 'string' || typeof value.codebook.url !== 'string')) return false
  return value.variables.every((variable) => {
    if (!isObject(variable) || typeof variable.name !== 'string' || typeof variable.description !== 'string') return false
    if (variable.label !== null && typeof variable.label !== 'string') return false
    if (variable.data_type !== null && typeof variable.data_type !== 'string') return false
    if (variable.unit !== null && typeof variable.unit !== 'string') return false
    return isStringArray(variable.allowed_values) && isStringArray(variable.evidence_ids)
      && evidenceStates.includes(String(variable.evidence_state) as (typeof evidenceStates)[number])
  })
}

function isCanonicalRecord(value: unknown, expectedRecordId: string) {
  if (!isObject(value)) return false
  if (value.schema_version !== 'observatory-record.v1.0.0' || value.record_id !== expectedRecordId || value.record_type !== 'dataset_asset') return false
  if (!isObject(value.identity) || !isObject(value.access) || !isObject(value.geography) || !isObject(value.time_coverage)) return false
  if (!isObject(value.capabilities) || !isObject(value.freshness_verification) || !isObject(value.retrieval) || !isObject(value.join_compatibility)) return false
  if (!Array.isArray(value.provenance) || !Array.isArray(value.evidence) || !Array.isArray(value.unit_of_analysis)) return false
  if (!hasExplicitVerification(value)) return false
  if (value.variable_documentation !== undefined && !isVariableDocumentation(value.variable_documentation)) return false
  return typeof value.title === 'string' && typeof value.description === 'string'
}

export function assertDiscoveryResult(value: unknown): asserts value is DiscoveryResult {
  if (!isObject(value) || value.contract_version !== 'observatory-discovery-result.v1.0.0') {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response does not use observatory-discovery-result.v1.0.0.')
  }
  if (typeof value.retrieval_id !== 'string' || !/^retrieval-[a-f0-9]{16}$/.test(value.retrieval_id)) {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response has an invalid retrieval identifier.')
  }
  if (value.evidence_mode !== 'published_offline_evidence' || !isObject(value.corpus) || !isObject(value.query)) {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response is missing its evidence, corpus, or query boundary.')
  }
  if (typeof value.corpus.corpus_id !== 'string' || typeof value.corpus.corpus_version !== 'string' || typeof value.corpus.record_count !== 'number' || typeof value.corpus.join_route_count !== 'number') {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response corpus metadata is invalid.')
  }
  if (typeof value.query.question !== 'string' || typeof value.query.normalized_question !== 'string' || !isObject(value.query.interpretation) || !isObject(value.query.filters)) {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response query metadata is invalid.')
  }
  const interpretation = value.query.interpretation
  if (!Array.isArray(interpretation.geographies) || !Array.isArray(interpretation.subjects) || !Array.isArray(interpretation.units_of_analysis) || !isObject(interpretation.access_intent)) {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response query interpretation is invalid.')
  }
  if (!Array.isArray(value.results) || typeof value.result_count !== 'number' || value.result_count !== value.results.length) {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response result count does not match its records.')
  }
  if (value.returned_count !== undefined && (typeof value.returned_count !== 'number' || value.returned_count !== value.results.length)) {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response returned_count does not match its records.')
  }
  if (value.total_matches !== undefined && (typeof value.total_matches !== 'number' || value.total_matches < value.results.length)) {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response total_matches is smaller than the returned records.')
  }
  if (value.has_more !== undefined) {
    if (typeof value.has_more !== 'boolean') {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response has_more must be a boolean.')
    }
    if (typeof value.total_matches === 'number' && value.has_more !== value.total_matches > value.results.length) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response has_more does not match total_matches and returned records.')
    }
  }
  for (const item of value.results) {
    if (!isObject(item) || typeof item.rank !== 'number' || typeof item.score !== 'number' || typeof item.record_id !== 'string' || !isObject(item.relevance)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response contains an invalid ranked result.')
    }
    if (!isStringArray(item.relevance.matched_subjects) || !isStringArray(item.relevance.matched_geographies) || !isStringArray(item.relevance.matched_units) || !isStringArray(item.relevance.matched_terms) || !isStringArray(item.relevance.why_relevant) || !Array.isArray(item.relevance.score_components)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery result relevance evidence is invalid.')
    }
    if (!isCanonicalRecord(item.record, item.record_id)) {
      throw new DiscoveryProviderError('invalid_contract', `Discovery result ${item.record_id} does not preserve a canonical Observatory record.`)
    }
  }
  if (!Array.isArray(value.join_routes) || !isStringArray(value.warnings)) {
    throw new DiscoveryProviderError('invalid_contract', 'Discovery response join routes or warnings are invalid.')
  }
  for (const route of value.join_routes) {
    if (!isObject(route) || typeof route.route_id !== 'string' || typeof route.from_record_id !== 'string' || typeof route.to_record_id !== 'string') {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response contains an invalid join route.')
    }
    if (!['documented', 'candidate', 'ambiguous', 'incompatible', 'unknown'].includes(String(route.compatibility_state))) {
      throw new DiscoveryProviderError('invalid_contract', `Join route ${route.route_id} has an invalid compatibility state.`)
    }
  }
}

function normalizeQuestion(value: string) {
  return value.trim().toLowerCase().replace(/^i need\s+/, '').replace(/\s+/g, ' ')
}

function abortError() {
  return new DiscoveryProviderError('aborted', 'Discovery request was aborted.')
}

export class FixtureDiscoveryProvider implements DiscoveryProvider {
  readonly kind = 'fixture' as const
  private responsePromise?: Promise<DiscoveryResult>

  constructor(
    private readonly loadResponse: () => unknown | Promise<unknown>,
    readonly promotionState: Extract<DiscoveryProviderPromotionState, 'accepted' | 'unpromoted'> = 'accepted',
  ) {}

  private load() {
    this.responsePromise ??= Promise.resolve(this.loadResponse()).then((value) => {
      assertDiscoveryResult(value)
      return structuredClone(value)
    })
    return this.responsePromise
  }

  async discover(query: DiscoveryQuery, options: DiscoveryRequestOptions = {}) {
    if (options.signal?.aborted) throw abortError()
    const response = await this.load()
    if (options.signal?.aborted) throw abortError()
    if (normalizeQuestion(query.question) !== normalizeQuestion(response.query.question)) {
      throw new DiscoveryProviderError(
        'fixture_query_unavailable',
        'The checked-in fixture does not contain an accepted response for this question. Configure the API provider for unrestricted queries.',
      )
    }
    return structuredClone(response)
  }

  async browse(options: DiscoveryRequestOptions = {}) {
    if (options.signal?.aborted) throw abortError()
    const response = structuredClone(await this.load())
    if (options.signal?.aborted) throw abortError()
    response.query = {
      question: 'Browse published health systems data',
      normalized_question: 'browse published health systems data',
      interpretation: {
        ...response.query.interpretation,
        geographies: [],
        subjects: [],
        units_of_analysis: [],
        time_window: null,
      },
      filters: { mode: 'catalog_browse' },
    }
    response.warnings = ['Fixture browse mode lists the accepted published records; order does not imply relevance or quality.', ...response.warnings]
    return response
  }

  async dataset(id: string, options: DiscoveryRequestOptions = {}) {
    if (options.signal?.aborted) throw abortError()
    const response = structuredClone(await this.load())
    if (options.signal?.aborted) throw abortError()
    const result = response.results.find((item) => item.record_id === id || item.record_id === `obs:asset:${id}` || item.record_id.replace(/^obs:asset:/, '') === id)
    if (!result) throw new DiscoveryProviderError('record_not_found', 'No published record has this identifier.')
    response.query.question = `Open dataset ${result.record_id}`
    response.query.normalized_question = response.query.question.toLowerCase()
    response.query.filters = { mode: 'stable_dataset_dereference', record_id: result.record_id, family_sibling_count: 0 }
    response.results = [{ ...result, rank: 1 }]
    response.result_count = 1
    response.returned_count = 1
    response.total_matches = 1
    response.has_more = false
    response.join_routes = response.join_routes.filter((route) => route.from_record_id === result.record_id || route.to_record_id === result.record_id)
    return response
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class ApiDiscoveryProvider implements DiscoveryProvider {
  readonly kind = 'api' as const
  readonly promotionState = 'remote' as const

  constructor(
    private readonly endpoint = '/api/discover',
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  ) {}

  private apiPath(resource: string) {
    return this.endpoint.endsWith('/discover')
      ? `${this.endpoint.slice(0, -'/discover'.length)}/${resource}`
      : `/api/${resource}`
  }

  private async requestJson(input: RequestInfo | URL, init: RequestInit, options: DiscoveryRequestOptions) {
    let response: Response
    try {
      response = await this.fetchImpl(input, { ...init, signal: options.signal })
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError()
      throw new DiscoveryProviderError('http_error', 'The discovery service could not be reached.')
    }
    if (!response.ok) {
      if (response.status === 404) throw new DiscoveryProviderError('record_not_found', 'No published record has this identifier.')
      throw new DiscoveryProviderError('http_error', `The discovery service returned HTTP ${response.status}.`)
    }
    const value: unknown = await response.json()
    assertDiscoveryResult(value)
    return structuredClone(value)
  }

  async discover(query: DiscoveryQuery, options: DiscoveryRequestOptions = {}) {
    return this.requestJson(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(query),
      }, options)
  }

  async browse(options: DiscoveryRequestOptions = {}) {
    return this.requestJson(this.apiPath('catalog?limit=200&corpus=1.1.0'), { method: 'GET', headers: { accept: 'application/json' } }, options)
  }

  async dataset(id: string, options: DiscoveryRequestOptions = {}) {
    return this.requestJson(this.apiPath(`datasets/${encodeURIComponent(id)}`), { method: 'GET', headers: { accept: 'application/json' } }, options)
  }
}

export function createDefaultDiscoveryProvider(): DiscoveryProvider {
  if (import.meta.env.VITE_DISCOVERY_PROVIDER === 'api') {
    return new ApiDiscoveryProvider(import.meta.env.VITE_DISCOVERY_API_PATH || '/api/discover')
  }
  return new FixtureDiscoveryProvider(loadAcceptedDiscoveryFixture, 'accepted')
}
