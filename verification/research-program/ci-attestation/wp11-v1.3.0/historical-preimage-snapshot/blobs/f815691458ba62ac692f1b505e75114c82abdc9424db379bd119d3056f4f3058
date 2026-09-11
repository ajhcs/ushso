import type { GroupMode, SortMode } from '../types/catalog'

export interface SearchRouteState {
  q: string
  group: GroupMode
  sort: SortMode
  page: number
  filters: string[]
  cursor: string | null
  generation: string | null
}

const validSorts: SortMode[] = ['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']

export function readSearchState(params: URLSearchParams): SearchRouteState {
  const rawPage = Number.parseInt(params.get('page') ?? '1', 10)
  const filters = params.getAll('filter')
  return {
    q: params.get('q')?.trim() ?? '',
    group: 'record',
    sort: validSorts.includes(params.get('sort') as SortMode) ? (params.get('sort') as SortMode) : 'canonical_relevance',
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    filters: filters.length > 0 ? filters : [],
    cursor: params.get('cursor'),
    generation: params.get('generation'),
  }
}

export function writeSearchState(state: SearchRouteState) {
  const params = new URLSearchParams()
  if (state.q.trim()) params.set('q', state.q.trim())
  params.set('sort', state.sort)
  params.set('page', String(state.page))
  if (state.filters.length === 0) params.set('filters', 'none')
  state.filters.forEach((filter) => params.append('filter', filter))
  if (state.cursor) params.set('cursor', state.cursor)
  if (state.generation) params.set('generation', state.generation)
  return params
}
