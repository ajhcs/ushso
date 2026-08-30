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
}

export class DiscoveryProviderError extends Error {
  constructor(readonly code: 'aborted' | 'fixture_query_unavailable' | 'http_error' | 'invalid_contract', message: string) {
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

function isCanonicalRecord(value: unknown, expectedRecordId: string) {
  if (!isObject(value)) return false
  if (value.schema_version !== 'observatory-record.v1.0.0' || value.record_id !== expectedRecordId || value.record_type !== 'dataset_asset') return false
  if (!isObject(value.identity) || !isObject(value.access) || !isObject(value.geography) || !isObject(value.time_coverage)) return false
  if (!isObject(value.capabilities) || !isObject(value.freshness_verification) || !isObject(value.retrieval) || !isObject(value.join_compatibility)) return false
  if (!Array.isArray(value.provenance) || !Array.isArray(value.evidence) || !Array.isArray(value.unit_of_analysis)) return false
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
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class ApiDiscoveryProvider implements DiscoveryProvider {
  readonly kind = 'api' as const
  readonly promotionState = 'remote' as const

  constructor(
    private readonly endpoint = '/api/discover',
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  ) {}

  async discover(query: DiscoveryQuery, options: DiscoveryRequestOptions = {}) {
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(query),
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError()
      throw new DiscoveryProviderError('http_error', 'The discovery service could not be reached.')
    }
    if (!response.ok) {
      throw new DiscoveryProviderError('http_error', `The discovery service returned HTTP ${response.status}.`)
    }
    const value: unknown = await response.json()
    assertDiscoveryResult(value)
    return structuredClone(value)
  }
}

export function createDefaultDiscoveryProvider(): DiscoveryProvider {
  if (import.meta.env.VITE_DISCOVERY_PROVIDER === 'api') {
    return new ApiDiscoveryProvider(import.meta.env.VITE_DISCOVERY_API_PATH || '/api/discover')
  }
  return new FixtureDiscoveryProvider(loadAcceptedDiscoveryFixture, 'accepted')
}
