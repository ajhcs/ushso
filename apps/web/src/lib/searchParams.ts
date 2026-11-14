import { validateInterpretationConstraints, type InterpretationConstraints } from './interpretationConstraints'
import type { GroupMode, SortMode } from '../types/catalog'

export interface SearchRouteState {
  q: string
  group: GroupMode
  sort: SortMode
  page: number
  filters: string[]
  cursor: string | null
  generation: string | null
  constraints?: InterpretationConstraints
}

const validSorts: SortMode[] = ['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']

export function readSearchState(params: URLSearchParams): SearchRouteState {
  const rawPage = Number.parseInt(params.get('page') ?? '1', 10)
  const filters = params.getAll('filter')
  let constraints: InterpretationConstraints | undefined
  if (params.has('controls') || params.has('subject') || params.has('geo') || params.has('year_start') || params.has('year_end')) {
    try { constraints = validateInterpretationConstraints({...(params.get('controls')==='1'?{override:true,coverageMode:(params.get('coverage')??'all') as InterpretationConstraints['coverageMode']}:{}),...(params.get('subject')?{subject:params.get('subject')!}:{}),...(params.get('geo')?{geography:params.get('geo')!}:{}),...(params.has('year_start')?{startYear:Number(params.get('year_start'))}:{}),...(params.has('year_end')?{endYear:Number(params.get('year_end'))}:{})}) } catch { constraints = undefined }
  }
  return {
    ...(constraints ? {constraints} : {}),
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
  if (state.constraints) {
    const value=validateInterpretationConstraints(state.constraints)
    if(value.override) {params.set('controls','1');params.set('coverage',value.coverageMode??'all')}
    if(value.subject) params.set('subject',value.subject)
    if(value.geography) params.set('geo',value.geography)
    if(value.startYear!==undefined) params.set('year_start',String(value.startYear))
    if(value.endYear!==undefined) params.set('year_end',String(value.endYear))
  }
  if (state.cursor) params.set('cursor', state.cursor)
  if (state.generation) params.set('generation', state.generation)
  return params
}
