import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { matchesFacetFilter } from '../data/facets'
import { browserRecordErrors } from '../../../../packages/retrieval/tools/catalog-contract.mjs'
import { safeExternalHttpsUrl } from '../../../../packages/retrieval/tools/external-url-policy.mjs'
import type { DiscoveryQuery, DiscoveryResult, DiscoverySort } from '../types/discovery'

export type DiscoveryProviderKind = 'fixture' | 'api'
export type DiscoveryProviderPromotionState = 'accepted' | 'unpromoted' | 'remote'

export interface DiscoveryRequestOptions {
  signal?: AbortSignal
  traversal?: DiscoveryTraversalRequest
}

export interface DiscoveryTraversalRequest {
  cursor?: string
  generation?: string
  pageSize?: number
  sort?: DiscoverySort
  filters?: string[]
}

export interface DiscoveryProvider {
  readonly kind: DiscoveryProviderKind
  readonly promotionState: DiscoveryProviderPromotionState
  discover(query: DiscoveryQuery, options?: DiscoveryRequestOptions): Promise<DiscoveryResult>
  browse(options?: DiscoveryRequestOptions): Promise<DiscoveryResult>
  dataset(id: string, options?: DiscoveryRequestOptions): Promise<DiscoveryResult>
}

export class DiscoveryProviderError extends Error {
  constructor(readonly code: 'aborted' | 'fixture_query_unavailable' | 'record_not_found' | 'generation_unavailable' | 'cursor_invalid' | 'http_error' | 'invalid_contract', message: string) {
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

function hasSafeDerivedMetadata(value: unknown) {
  if (value === undefined) return true
  if (!isObject(value)) return false
  const descriptionQuality = value.description_quality
  if (descriptionQuality !== undefined) {
    if (!isObject(descriptionQuality)) return false
    if (descriptionQuality.authoritative_url !== null && safeExternalHttpsUrl(descriptionQuality.authoritative_url) === null) return false
  }
  const plan = value.retrieval_plan
  if (plan !== undefined) {
    if (!isObject(plan) || !Array.isArray(plan.access_routes) || !Array.isArray(plan.unresolved_routes) || !Array.isArray(plan.stop_conditions)) return false
    if (!plan.access_routes.every((step) => isObject(step) && step.action !== 'stop_and_report' && safeExternalHttpsUrl(step.url) !== null)) return false
    if (!plan.unresolved_routes.every((step) => isObject(step) && step.action !== 'stop_and_report' && step.url === null)) return false
    if (!plan.stop_conditions.every((step) => isObject(step) && step.action === 'stop_and_report' && step.url === null)) return false
  }
  return true
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
  if (value.ranking !== undefined) {
    if (!isObject(value.ranking) || !isNonEmptyString(value.ranking.version) || !isNonEmptyString(value.ranking.sort) || !isStringArray(value.ranking.ordered_ids)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response ranking metadata is invalid.')
    }
    if (value.ranking.ordered_ids.length !== value.results.length || value.ranking.ordered_ids.some((id, index) => id !== (value.results as Array<Record<string, unknown>>)[index]?.record_id)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response ranking order does not match its records.')
    }
  }
  if (value.pagination !== undefined) {
    const pagination = value.pagination
    if (!isObject(pagination) || !isNonEmptyString(pagination.generation) || typeof pagination.has_more !== 'boolean'
      || !Number.isInteger(pagination.page_size) || Number(pagination.page_size) < 1
      || !Number.isInteger(pagination.total_matches) || Number(pagination.total_matches) < value.results.length
      || (pagination.cursor !== null && typeof pagination.cursor !== 'string')
      || (pagination.next_cursor !== null && typeof pagination.next_cursor !== 'string')) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response pagination metadata is invalid.')
    }
  }
  if (value.facets !== undefined) {
    const facets = value.facets
    if (!isObject(facets) || !['records', 'families'].includes(String(facets.count_basis))
      || !isNonEmptyString(facets.collection_scope) || typeof facets.approximate !== 'boolean' || !Array.isArray(facets.sections)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response facet metadata is invalid.')
    }
    for (const section of facets.sections) {
      if (!isObject(section) || !isNonEmptyString(section.id) || !isNonEmptyString(section.label) || !Array.isArray(section.options)) {
        throw new DiscoveryProviderError('invalid_contract', 'Discovery response contains an invalid facet section.')
      }
      for (const option of section.options) {
        if (!isObject(option) || !isNonEmptyString(option.value) || !isNonEmptyString(option.label) || !Number.isInteger(option.count) || Number(option.count) < 0) {
          throw new DiscoveryProviderError('invalid_contract', `Discovery facet ${section.id} contains an invalid option.`)
        }
      }
    }
  }
  const returnedIds = new Set((value.results as Array<Record<string, unknown>>).map((item) => String(item.record_id)))
  if (value.sections !== undefined) {
    if (!isObject(value.sections) || !isStringArray(value.sections.supported) || !isStringArray(value.sections.uncertain)
      || (value.sections.contextual !== undefined && !isStringArray(value.sections.contextual))) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response result sections are invalid.')
    }
    const sectionIds = [...value.sections.supported, ...value.sections.uncertain, ...(value.sections.contextual ?? [])]
    if (sectionIds.some((id) => !returnedIds.has(id)) || new Set(sectionIds).size !== sectionIds.length) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response sections do not uniquely partition returned records.')
    }
  }
  if (value.partial_results !== undefined) {
    const partial = value.partial_results
    if (!isObject(partial) || typeof partial.is_partial !== 'boolean' || !Number.isInteger(partial.invalid_item_count)
      || Number(partial.invalid_item_count) < 0 || !Array.isArray(partial.issues)
      || partial.is_partial !== (Number(partial.invalid_item_count) > 0)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery partial-results metadata is invalid.')
    }
  }
  if (value.receipt !== undefined) {
    const receipt = value.receipt
    if (!isObject(receipt) || receipt.manifest_version !== 'observatory-search-manifest.v1.0.0'
      || receipt.scope !== 'current_page' || !isNonEmptyString(receipt.question) || !isObject(receipt.interpreted_constraints)
      || !isObject(receipt.filters) || !isNonEmptyString(receipt.sort) || !isStringArray(receipt.displayed_ordered_ids)
      || !isNonEmptyString(receipt.ranking_version) || !isNonEmptyString(receipt.catalog_generation)
      || !isNonEmptyString(receipt.generated_at) || !Array.isArray(receipt.citations) || !isStringArray(receipt.limitations)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response search manifest is invalid.')
    }
    if (receipt.displayed_ordered_ids.length !== value.results.length || receipt.displayed_ordered_ids.some((id, index) => id !== (value.results as Array<Record<string, unknown>>)[index]?.record_id)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery search manifest does not preserve displayed response order.')
    }
  }
  for (const item of value.results) {
    if (!isObject(item) || typeof item.rank !== 'number' || typeof item.score !== 'number' || typeof item.record_id !== 'string' || !isObject(item.relevance)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery response contains an invalid ranked result.')
    }
    if (!isStringArray(item.relevance.matched_subjects) || !isStringArray(item.relevance.matched_geographies) || !isStringArray(item.relevance.matched_units) || !isStringArray(item.relevance.matched_terms) || !isStringArray(item.relevance.why_relevant) || !Array.isArray(item.relevance.score_components)) {
      throw new DiscoveryProviderError('invalid_contract', 'Discovery result relevance evidence is invalid.')
    }
    const recordErrors = isObject(item.record) ? browserRecordErrors(item.record) : ['record must be an object']
    if (!isObject(item.record) || item.record.record_id !== item.record_id || recordErrors.length > 0) {
      throw new DiscoveryProviderError('invalid_contract', `Discovery result ${item.record_id} does not preserve a canonical Observatory record: ${recordErrors.join('; ') || 'record identifier mismatch'}.`)
    }
    if (!hasSafeDerivedMetadata(item.metadata)) {
      throw new DiscoveryProviderError('invalid_contract', `Discovery result ${item.record_id} contains unsafe derived navigation metadata.`)
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

function queryWithTraversal(query: DiscoveryQuery, traversal?: DiscoveryTraversalRequest): DiscoveryQuery {
  if (!traversal) return query
  const facetFilters = traversal.filters?.reduce<Record<string, string[]>>((grouped, filter) => {
    const separator = filter.indexOf(':')
    if (separator <= 0 || separator === filter.length - 1) return grouped
    const browserKey = filter.slice(0, separator)
    const key = ({
      'data-category': 'capability', access: 'access_status', 'reporting-unit': 'unit_of_analysis',
    } as Record<string, string>)[browserKey] ?? browserKey
    grouped[key] = [...(grouped[key] ?? []), filter.slice(separator + 1)]
    return grouped
  }, {})
  return {
    ...query,
    ...(traversal.cursor ? { cursor: traversal.cursor } : {}),
    ...(traversal.generation ? { generation: traversal.generation } : {}),
    ...(traversal.pageSize ? { page_size: traversal.pageSize } : {}),
    ...(traversal.sort ? { sort: traversal.sort } : {}),
    ...(facetFilters && Object.keys(facetFilters).length > 0 ? { facet_filters: facetFilters } : {}),
  }
}

function fixtureFacetFilters(query: DiscoveryQuery, traversal?: DiscoveryTraversalRequest) {
  const grouped: Record<string, string[]> = {}
  const add = (section: string, value: string) => {
    if (!section || !value) return
    grouped[section] = [...(grouped[section] ?? []), value]
  }
  for (const [section, values] of Object.entries(query.facet_filters ?? {})) {
    for (const value of values) add(section, value)
  }
  for (const filter of traversal?.filters ?? []) {
    const separator = filter.indexOf(':')
    if (separator <= 0 || separator === filter.length - 1) continue
    add(filter.slice(0, separator), filter.slice(separator + 1))
  }
  return grouped
}

function applyFixtureFacetFilters(response: DiscoveryResult, filters: Record<string, string[]>) {
  const entries = Object.entries(filters).filter(([, values]) => values.length > 0)
  if (entries.length === 0) return response
  const selectedIds = new Set<string>()
  response.results = response.results.filter((result) => {
    const matches = entries.every(([section, values]) => values.some((value) => matchesFacetFilter(result.record, section, value)))
    if (matches) selectedIds.add(result.record_id)
    return matches
  })
  response.result_count = response.results.length
  response.returned_count = response.results.length
  response.total_matches = response.results.length
  response.has_more = false
  response.query = {
    ...response.query,
    filters: {
      ...response.query.filters,
      facet_filters: Object.fromEntries(entries),
    },
  }
  response.join_routes = response.join_routes.filter((route) => selectedIds.has(route.from_record_id) && selectedIds.has(route.to_record_id))
  response.warnings = [
    'Fixture facet filters were applied to the accepted response records; counts are bounded to this fixture response scope.',
    ...response.warnings,
  ]
  return response
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
    return applyFixtureFacetFilters(structuredClone(response), fixtureFacetFilters(query, options.traversal))
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
    return applyFixtureFacetFilters(response, fixtureFacetFilters({ question: '' }, options.traversal))
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
      let body: unknown
      try { body = await response.json() } catch { body = null }
      const serviceCode = isObject(body) && isObject(body.error) && typeof body.error.code === 'string' ? body.error.code : ''
      const serviceMessage = isObject(body) && isObject(body.error) && typeof body.error.message === 'string'
        ? body.error.message
        : `The discovery service returned HTTP ${response.status}.`
      if (response.status === 404) throw new DiscoveryProviderError('record_not_found', serviceMessage)
      if (response.status === 409 || response.status === 410 || serviceCode === 'generation_unavailable') {
        throw new DiscoveryProviderError('generation_unavailable', 'This result traversal belongs to an unavailable catalog generation. Restart the search to use the current catalog.')
      }
      if (response.status === 400 && serviceCode.includes('cursor')) throw new DiscoveryProviderError('cursor_invalid', serviceMessage)
      throw new DiscoveryProviderError('http_error', serviceMessage)
    }
    const value: unknown = await response.json()
    assertDiscoveryResult(value)
    return structuredClone(value)
  }

  async discover(query: DiscoveryQuery, options: DiscoveryRequestOptions = {}) {
    return this.requestJson(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(queryWithTraversal(query, options.traversal)),
      }, options)
  }

  async browse(options: DiscoveryRequestOptions = {}) {
    const params = new URLSearchParams()
    const traversal = options.traversal
    if (traversal?.cursor) params.set('cursor', traversal.cursor)
    if (traversal?.generation) params.set('generation', traversal.generation)
    if (traversal?.pageSize) params.set('page_size', String(traversal.pageSize))
    if (traversal?.sort) params.set('sort', traversal.sort)
    traversal?.filters?.forEach((filter) => params.append('filter', filter))
    const query = params.size ? `?${params}` : ''
    return this.requestJson(this.apiPath(`catalog${query}`), { method: 'GET', headers: { accept: 'application/json' } }, options)
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
