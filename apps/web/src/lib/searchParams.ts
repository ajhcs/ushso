import type { GroupMode, SortMode } from '../types/catalog'

export interface SearchRouteState {
  q: string
  group: GroupMode
  sort: SortMode
  page: number
  filters: string[]
}

const validSorts: SortMode[] = ['best', 'title', 'newest']

export function readSearchState(params: URLSearchParams): SearchRouteState {
  const rawPage = Number.parseInt(params.get('page') ?? '1', 10)
  const filters = params.getAll('filter')
  return {
    q: params.get('q')?.trim() || 'hospital financial and utilization data for Pennsylvania',
    group: params.get('group') === 'record' ? 'record' : 'family',
    sort: validSorts.includes(params.get('sort') as SortMode) ? (params.get('sort') as SortMode) : 'best',
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    filters: filters.length > 0 ? filters : [],
  }
}

export function writeSearchState(state: SearchRouteState) {
  const params = new URLSearchParams()
  params.set('q', state.q)
  params.set('group', state.group)
  params.set('sort', state.sort)
  params.set('page', String(state.page))
  if (state.filters.length === 0) params.set('filters', 'none')
  state.filters.forEach((filter) => params.append('filter', filter))
  return params
}
