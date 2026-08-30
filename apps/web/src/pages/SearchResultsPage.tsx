import { Info, PanelLeftOpen, Search } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FacetSidebar } from '../components/FacetSidebar'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { Pagination } from '../components/Pagination'
import { ResultCard } from '../components/ResultCard'
import { buildFacetSections } from '../data/facets'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { readSearchState, writeSearchState, type SearchRouteState } from '../lib/searchParams'
import { discoveryBounds, formatDiscoveryCountSummary } from '../lib/resultCounts'
import { filterCatalog, getGroupingDescription, orderCatalogViews } from '../lib/uiSearch'
import { useDiscoveryResult } from '../providers/DiscoveryProviderContext'

const PAGE_SIZE = 10

function interpretationSummary(result: NonNullable<ReturnType<typeof adaptDiscoveryResponse>>['canonicalResponse']) {
  const interpretation = result.query.interpretation
  const concepts = [
    ...interpretation.geographies.map((item) => item.label),
    ...interpretation.subjects.map((item) => item.label),
    ...interpretation.units_of_analysis.map((item) => item.label),
  ]
  if (result.query.filters.mode === 'catalog_browse') return 'Catalog browse: no question or geography filter is being assumed.'
  return concepts.length > 0
    ? `Query understood as: ${[...new Set(concepts)].join(' · ')}.`
    : 'No controlled geography, subject, or reporting unit was inferred from this question.'
}

export function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(() => readSearchState(searchParams), [searchParams])
  const [editQuery, setEditQuery] = useState(state.q)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const filterTriggerRef = useRef<HTMLButtonElement>(null)
  const filterDialogRef = useRef<HTMLDivElement>(null)
  const discovery = useDiscoveryResult(state.q)
  const catalog = useMemo(
    () => discovery.status === 'ready' ? adaptDiscoveryResponse(discovery.result) : null,
    [discovery],
  )

  useEffect(() => setEditQuery(state.q), [state.q])
  useEffect(() => {
    if (!mobileFiltersOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = filterDialogRef.current
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    const focusables = () => [...(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    requestAnimationFrame(() => (focusables()[0] ?? dialog)?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileFiltersOpen(false)
        requestAnimationFrame(() => filterTriggerRef.current?.focus())
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobileFiltersOpen])

  const updateState = (patch: Partial<SearchRouteState>) => {
    setSearchParams(writeSearchState({ ...state, ...patch }))
  }
  const closeMobileFilters = () => {
    setMobileFiltersOpen(false)
    requestAnimationFrame(() => filterTriggerRef.current?.focus())
  }

  const filteredFamilies = useMemo(
    () => orderCatalogViews(filterCatalog(catalog?.families ?? [], state.filters), state.sort, state.q),
    [catalog, state.filters, state.q, state.sort],
  )
  const filteredRecords = useMemo(
    () => orderCatalogViews(filterCatalog(catalog?.records ?? [], state.filters), state.sort, state.q),
    [catalog, state.filters, state.q, state.sort],
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
    updateState({ q: editQuery.trim(), page: 1, filters: [] })
  }

  const bounds = discovery.status === 'ready' ? discoveryBounds(discovery.result) : null
  const countParts = bounds
    ? formatDiscoveryCountSummary({
      returnedCount: bounds.returnedCount,
      hasMore: bounds.hasMore,
      filteredRecordCount: filteredRecords.length,
      filtersActive: state.filters.length > 0,
    })
    : []

  return (
    <div className="results-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="results-shell">
        <Link className="back-link" to="/">← <span>Back to search</span></Link>
        <div className="results-content">
          <form className="results-query" role="search" onSubmit={submitEditedSearch}>
            <label className="sr-only" htmlFor="results-query-input">Search question</label>
            <div className="results-query__input">
              <Search aria-hidden="true" />
              <input id="results-query-input" value={editQuery} placeholder="Ask a health-systems data question, or leave blank to browse" onChange={(event) => setEditQuery(event.target.value)} />
            </div>
            <button type="submit"><Search aria-hidden="true" /> Search</button>
          </form>

          {discovery.status === 'ready' && catalog && (
            <>
              <div className="results-overview">
                <div>
                  <p className="results-count">{countParts.map((part, index) => (
                    <span key={part}>{index > 0 && <span aria-hidden="true">·</span>}<strong>{part}</strong></span>
                  ))}</p>
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
                    <button type="button" role="switch" aria-checked={state.group === 'family'} aria-label="Group results by family" onClick={() => updateState({ group: state.group === 'family' ? 'record' : 'family', page: 1 })}>
                      <span />
                    </button>
                    <Info aria-label="Grouping reduces duplicate records" />
                  </div>
                </div>
              </div>
              <div className="query-evidence" role="note">
                <p><strong>{interpretationSummary(discovery.result)}</strong></p>
                {discovery.result.warnings.length > 0 && <ul>{discovery.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
              </div>
            </>
          )}

          {discovery.status === 'ready' && catalog && (
            <button ref={filterTriggerRef} className="mobile-filter-trigger" type="button" onClick={() => setMobileFiltersOpen(true)}>
              <PanelLeftOpen aria-hidden="true" /> Refine results
              {state.filters.length > 0 && <span>{state.filters.length}</span>}
            </button>
          )}

          <div className="results-list" aria-busy={discovery.status === 'loading'}>
            {discovery.status === 'loading' ? (
              <div className="discovery-state" role="status">
                <span className="discovery-state__spinner" aria-hidden="true" />
                <h2>{state.q ? 'Searching the Observatory index…' : 'Loading the published catalog…'}</h2>
                <p>No result count is shown until the published response has loaded.</p>
              </div>
            ) : discovery.status === 'error' ? (
              <div className="discovery-state discovery-state--error" role="alert">
                <h2>Discovery results are not available.</h2>
                <p>{discovery.error.message}</p>
                <Link className="button-link" to="/">Revise search</Link>
              </div>
            ) : visibleItems.length > 0 ? visibleItems.map((result) => (
              <ResultCard key={result.id} result={result} />
            )) : state.filters.length > 0 ? (
              <div className="empty-results">
                <h2>No returned results match these filters.</h2>
                <button type="button" onClick={() => updateState({ filters: [], page: 1 })}>Clear filters</button>
              </div>
            ) : (
              <div className="empty-results">
                <h2>No indexed source matched this question.</h2>
                <p>This is not evidence that no source exists. Try broader terms or remove a geographic constraint.</p>
                <Link className="button-link" to="/">Revise search</Link>
              </div>
            )}
          </div>

          {discovery.status === 'ready' && (
            <p className="results-footnote"><Info aria-hidden="true" />
              <span>Grouping reduces duplicates and may hide near-duplicate records. Restricted and non-catalog sources may not be included.<br />Results are not comprehensive. Use details pages to confirm content, coverage, and access requirements.</span>
            </p>
          )}
          {discovery.status === 'ready' && activeItems.length > PAGE_SIZE && <Pagination currentPage={safePage} pageCount={pageCount} onChange={(page) => updateState({ page })} />}
        </div>
        {catalog && <div className="desktop-facets"><FacetSidebar sections={facetSections} selected={state.filters} onToggle={toggleFilter} onClear={() => updateState({ filters: [], page: 1 })} /></div>}
        {mobileFiltersOpen && catalog && (
          <div className="filter-overlay" role="presentation" onMouseDown={closeMobileFilters}>
            <div ref={filterDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Refine results" onMouseDown={(event) => event.stopPropagation()}>
              <FacetSidebar sections={facetSections} mobile selected={state.filters} onToggle={toggleFilter} onClear={() => updateState({ filters: [], page: 1 })} onClose={closeMobileFilters} />
            </div>
          </div>
        )}
      </main>
      <ObservatoryFooter results />
    </div>
  )
}
