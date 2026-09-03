import type { ObservatoryToolkitAdapter } from './registerObservatoryToolkit'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type JsonObject = Record<string, unknown>

function append(parameters: URLSearchParams, name: string, value: unknown) {
  if (value === null || value === undefined) return
  parameters.append(name, typeof value === 'string' ? value : JSON.stringify(value))
}

function appendAll(parameters: URLSearchParams, name: string, values: unknown) {
  if (!Array.isArray(values)) return
  for (const value of values) append(parameters, name, value)
}

function assetPath(input: JsonObject, suffix = '') {
  if (typeof input.record_id !== 'string') throw new TypeError('record_id is required')
  return `/api/machine/v1/assets/${encodeURIComponent(input.record_id)}${suffix}`
}

function routeFor(capability: string, input: JsonObject) {
  const parameters = new URLSearchParams()
  if (capability === 'search_assets') return { method: 'POST', path: '/api/machine/v1/search-assets' }
  if (capability === 'compare_assets') return { method: 'POST', path: '/api/machine/v1/compare-assets' }
  if (capability === 'plan_research') return { method: 'POST', path: '/api/machine/v1/plan-research' }

  append(parameters, 'generation', input.expected_generation)
  let path: string
  switch (capability) {
    case 'get_asset': {
      path = assetPath(input)
      const limits = input.collection_limits as JsonObject | undefined
      const cursors = input.collection_cursors as JsonObject | undefined
      for (const name of ['releases', 'distributions', 'documentation', 'schemas']) {
        append(parameters, `${name}_limit`, limits?.[name])
        append(parameters, `${name}_cursor`, cursors?.[name])
      }
      break
    }
    case 'get_access_plan':
    case 'get_retrieval_recipe': {
      path = assetPath(input, capability === 'get_access_plan' ? '/access-plan' : '/retrieval-recipe')
      for (const name of ['release_id', 'distribution_id', 'access_route_id']) append(parameters, name, input[name])
      break
    }
    case 'get_variables': {
      path = assetPath(input, '/variables')
      for (const name of ['release_id', 'distribution_id', 'schema_id', 'semantic_query', 'limit', 'cursor']) append(parameters, name, input[name])
      append(parameters, 'filters', input.filters)
      break
    }
    case 'get_join_routes': {
      path = '/api/machine/v1/join-routes'
      for (const name of ['from_id', 'to_id', 'from_release_id', 'to_release_id', 'research_purpose', 'include_indirect', 'max_hops', 'limit']) append(parameters, name, input[name])
      break
    }
    case 'get_coverage_status': {
      path = '/api/machine/v1/coverage-status'
      appendAll(parameters, 'geography_id', input.geography_ids)
      appendAll(parameters, 'subject_id', input.subject_ids)
      appendAll(parameters, 'source_class', input.source_classes)
      append(parameters, 'time_period', input.time_period)
      appendAll(parameters, 'authority_level', input.authority_levels)
      append(parameters, 'limit', input.limit)
      append(parameters, 'cursor', input.cursor)
      break
    }
    default: throw new TypeError(`Unknown machine capability: ${capability}`)
  }
  const query = parameters.toString()
  return { method: 'GET', path: query ? `${path}?${query}` : path }
}

export function createBrowserMachineToolkitClient(fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)): ObservatoryToolkitAdapter {
  return Object.freeze({
    async invokeWebMcp(capability: string, input: unknown, options: { signal?: AbortSignal } = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Machine-toolkit input must be an object')
      const route = routeFor(capability, input as JsonObject)
      const response = await fetchImpl(route.path, {
        method: route.method,
        headers: { accept: 'application/json', ...(route.method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        body: route.method === 'POST' ? JSON.stringify(input) : undefined,
        signal: options.signal,
      })
      if (!response.ok) throw new Error(`USHSO machine toolkit returned HTTP ${response.status}`)
      return response.json()
    },
  })
}
