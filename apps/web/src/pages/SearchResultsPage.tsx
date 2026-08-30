import { Info, PanelLeftOpen, Pencil, Search } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FacetSidebar } from '../components/FacetSidebar'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { Pagination } from '../components/Pagination'
import { ResultCard } from '../components/ResultCard'
import { buildFacetSections } from '../data/facets'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { filterCatalog, getGroupingDescription, orderCatalogViews } from '../lib/uiSearch'
import { readSearchState, writeSearchState, type SearchRouteState } from '../lib/searchParams'
import { useDiscoveryResult } from '../providers/DiscoveryProviderContext'

const PAGE_SIZE = 4
const presentQuery = (query: string) => /^i need\b/i.test(query) ? query : `I need ${query}`
const normalizeEditedQuery = (query: string) => query.replace(/^i need\s+/i, '').trim()

export function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(() => readSearchState(searchParams), [searchParams])
  const [editQuery, setEditQuery] = useState(() => presentQuery(state.q))
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const discovery = useDiscoveryResult(state.q)
  const catalog = useMemo(
    () => discovery.status === 'ready' ? adaptDiscoveryResponse(discovery.result) : null,
    [discovery],
  )

  useEffect(() => setEditQuery(presentQuery(state.q)), [state.q])
  useEffect(() => {
    if (!mobileFiltersOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mobileFiltersOpen])

  const updateState = (patch: Partial<SearchRouteState>) => {
    setSearchParams(writeSearchState({ ...state, ...patch }))
  }

  useEffect(() => {
    if (discovery.status !== 'ready' || searchParams.has('filter') || searchParams.get('filters') === 'none') return
    const includesPennsylvania = discovery.result.query.interpretation.geographies.some((geography) => geography.id === 'US-PA')
    if (includesPennsylvania) updateState({ filters: ['geography:pennsylvania'], page: 1 })
  }, [discovery, searchParams])

  const filteredFamilies = useMemo(
    () => orderCatalogViews(filterCatalog(catalog?.families ?? [], state.filters), state.sort),
    [catalog, state.filters, state.sort],
  )
  const filteredRecords = useMemo(
    () => orderCatalogViews(filterCatalog(catalog?.records ?? [], state.filters), state.sort),
    [catalog, state.filters, state.sort],
  )
  const activeItems = state.group === 'family' ? filteredFamilies : filteredRecords
  const facetItems = state.group === 'family' ? catalog?.families ?? [] : catalog?.records ?? []
  const facetSections = useMemo(() => buildFacetSections(facetItems), [facetItems])
  const pageCount = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE))
  const safePage = Math.min(state.page, pageCount)
  const visibleItems = activeItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (state.page !== safePage) updateState({ page: safePage })
  }, [safePage, state.page])

  const toggleFilter = (filter: string) => {
    const filters = state.filters.includes(filter)
      ? state.filters.filter((selected) => selected !== filter)
      : [...state.filters, filter]
    updateState({ filters, page: 1 })
  }

  const submitEditedSearch = (event: FormEvent) => {
    event.preventDefault()
    const q = normalizeEditedQuery(editQuery)
    if (q) updateState({ q, page: 1 })
  }

  const familyCount = filteredFamilies.length
  const recordCount = filteredRecords.length
  const sourceCount = new Set(activeItems.map((item) => item.sourceName)).size

  return (
    <div className="results-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="results-shell">
        <Link className="back-link" to={`/?q=${encodeURIComponent(state.q)}`}>← <span>Back to search</span></Link>
        <div className="results-content">
          <form className="results-query" role="search" onSubmit={submitEditedSearch}>
            <label className="sr-only" htmlFor="results-query-input">Search query</label>
            <div className="results-query__input">
              <Search aria-hidden="true" />
              <input id="results-query-input" value={editQuery} onChange={(event) => setEditQuery(event.target.value)} />
            </div>
            <button type="submit"><Pencil aria-hidden="true" /> Edit search</button>
          </form>

          <div className="results-overview">
            <div>
              <p className="results-count"><strong>{familyCount} dataset families</strong><span>·</span><strong>{recordCount} records</strong><span>·</span><strong>{sourceCount} sources</strong></p>
              <p>{getGroupingDescription(state.group)}</p>
              <p className="facet-helper"><Info aria-hidden="true" />Facet counts show {state.group === 'family' ? 'families' : 'records'} while grouping is {state.group === 'family' ? 'enabled' : 'disabled'}. Counts overlap and will not sum to the total.</p>
            </div>
            <div className="results-toolbar">
              <label>Sort by:
                <select value={state.sort} onChange={(event) => updateState({ sort: event.target.value as SearchRouteState['sort'], page: 1 })}>
                  <option value="best">Best match</option>
                  <option value="title">Title</option>
                  <option value="newest">Newest release</option>
                </select>
              </label>
              <div className="group-toggle">
                <span>Group by family</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={state.group === 'family'}
                  aria-label="Group results by family"
                  onClick={() => updateState({ group: state.group === 'family' ? 'record' : 'family', page: 1 })}
                >
                  <span />
                </button>
                <Info aria-label="Grouping reduces duplicate records" />
              </div>
            </div>
          </div>

          <button className="mobile-filter-trigger" type="button" onClick={() => setMobileFiltersOpen(true)}>
            <PanelLeftOpen aria-hidden="true" /> Refine results
            {state.filters.length > 0 && <span>{state.filters.length}</span>}
          </button>

          <div className="results-list" aria-busy={discovery.status === 'loading'}>
            {discovery.status === 'loading' ? (
              <div className="discovery-state" role="status">
                <span className="discovery-state__spinner" aria-hidden="true" />
                <h2>Searching the Observatory index…</h2>
                <p>Matching source metadata, access requirements, geography, grain, and evidence.</p>
              </div>
            ) : discovery.status === 'error' ? (
              <div className="discovery-state discovery-state--error" role="alert">
                <h2>Discovery results are not available for this question.</h2>
                <p>{discovery.error.message}</p>
                <Link className="button-link" to={`/?q=${encodeURIComponent(state.q)}`}>Revise search</Link>
              </div>
            ) : visibleItems.length > 0 ? visibleItems.map((result, index) => (
              <ResultCard key={result.id} result={result} displayRank={(safePage - 1) * PAGE_SIZE + index + 1} />
            )) : (
              <div className="empty-results">
                <h2>No returned results match these filters.</h2>
                <button type="button" onClick={() => updateState({ filters: [], page: 1 })}>Clear filters</button>
              </div>
            )}
          </div>

          <p className="results-footnote"><Info aria-hidden="true" />
            <span>Grouping reduces duplicates and may hide near-duplicate records. Restricted and non-catalog sources may not be included.<br />Results are not comprehensive. Use details pages to confirm content, coverage, and access requirements.</span>
          </p>
          <Pagination currentPage={safePage} pageCount={pageCount} onChange={(page) => updateState({ page })} />
        </div>
        <div className="desktop-facets">
          <FacetSidebar sections={facetSections} selected={state.filters} onToggle={toggleFilter} onClear={() => updateState({ filters: [], page: 1 })} />
        </div>
        {mobileFiltersOpen && (
          <div className="filter-overlay" role="presentation" onMouseDown={() => setMobileFiltersOpen(false)}>
            <div role="dialog" aria-modal="true" aria-label="Refine results" onMouseDown={(event) => event.stopPropagation()}>
              <FacetSidebar sections={facetSections} mobile selected={state.filters} onToggle={toggleFilter} onClear={() => updateState({ filters: [], page: 1 })} onClose={() => setMobileFiltersOpen(false)} />
            </div>
          </div>
        )}
      </main>
      <ObservatoryFooter results />
    </div>
  )
}
