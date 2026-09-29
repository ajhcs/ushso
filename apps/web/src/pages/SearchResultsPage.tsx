import { Download, ExternalLink, Info, PanelLeftOpen, Search } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FacetSidebar } from '../components/FacetSidebar'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { Pagination } from '../components/Pagination'
import { ResultCard } from '../components/ResultCard'
import { buildFacetSections } from '../data/facets'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { searchDocumentTitle, setDocumentTitle } from '../lib/documentTitle'
import { createSearchReturnContext, datasetDetailsHref, resultAnchorId } from '../lib/returnContext'
import { createSearchReceipt, downloadSearchReceipt } from '../lib/searchReceipt'
import { readSearchState, writeSearchState, type SearchRouteState } from '../lib/searchParams'
import { useDiscoveryResult } from '../providers/DiscoveryProviderContext'
import type { DatasetRecord, FacetSectionConfig } from '../types/catalog'

const PAGE_SIZE = 10

function selectedFacetFilters(filters: string[]) {
  return filters.reduce<Record<string, string[]>>((result, filter) => {
    const separator = filter.indexOf(':')
    if (separator < 1) return result
    const section = filter.slice(0, separator)
    const value = filter.slice(separator + 1)
    result[section] = [...(result[section] ?? []), value]
    return result
  }, {})
}

function interpretationLines(result: NonNullable<ReturnType<typeof adaptDiscoveryResponse>>['canonicalResponse']) {
  const interpretation = result.query.interpretation
  const concepts = [
    ...interpretation.geographies.map((item) => item.label),
    ...interpretation.subjects.map((item) => item.label),
    ...interpretation.units_of_analysis.map((item) => item.label),
  ]
  const lines: string[] = []
  if (result.query.filters.mode === 'catalog_browse') lines.push('Catalog browse: no question or geography filter is being assumed.')
  else lines.push(concepts.length > 0 ? `Interpreted concepts: ${[...new Set(concepts)].join(' · ')}.` : 'No controlled geography, subject, or observation unit was inferred.')
  if (interpretation.time_window) lines.push(`Years interpreted as ${interpretation.time_window.start_year ?? 'open'}–${interpretation.time_window.end_year ?? 'open'} (${interpretation.time_window.match_basis}). Unknown observation periods are not confirmed matches.`)
  if (interpretation.access_intent.public_only) lines.push(`Access interpreted as public payload required (${interpretation.access_intent.match_basis}). Catalog visibility alone does not satisfy this requirement.`)
  if (interpretation.exclusions?.length) lines.push(`Exclusions: ${interpretation.exclusions.map((item) => `${item.phrase} (${item.support})`).join(' · ')}.`)
  return lines
}

function resultSections(records: DatasetRecord[]) {
  const supported = records.filter((record) => !record.canonicalResult.match_state || record.canonicalResult.match_state === 'supported')
  const uncertain = records.filter((record) => record.canonicalResult.match_state === 'uncertain')
  const contextual = records.filter((record) => record.canonicalResult.match_state === 'contextual')
  return { supported, uncertain, contextual }
}

export function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const state = useMemo(() => readSearchState(searchParams), [searchParams])
  const [editQuery, setEditQuery] = useState(state.q)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const filterTriggerRef = useRef<HTMLButtonElement>(null)
  const filterDialogRef = useRef<HTMLDivElement>(null)
  const cursorByPage = useRef(new Map<number, string | null>([[1, null]]))
  const facetFilters = useMemo(() => selectedFacetFilters(state.filters), [state.filters])
  const discovery = useDiscoveryResult(state.q, {
    page_size: PAGE_SIZE,
    ...(state.cursor ? { cursor: state.cursor } : {}),
    ...(state.generation ? { generation: state.generation } : {}),
    sort: state.sort,
    ...(Object.keys(facetFilters).length > 0 ? { facet_filters: facetFilters } : {}),
  })
  const catalog = useMemo(() => discovery.status === 'ready' ? adaptDiscoveryResponse(discovery.result) : null, [discovery])

  useEffect(() => setEditQuery(state.q), [state.q])
  useEffect(() => setDocumentTitle(searchDocumentTitle(state.q, discovery.status === 'ready' ? 'ready' : discovery.status)), [discovery.status, state.q])
  useEffect(() => {
    if (state.page === 1 && !state.cursor) cursorByPage.current = new Map([[1, null]])
    else cursorByPage.current.set(state.page, state.cursor)
  }, [state.cursor, state.page, state.q, state.sort, state.filters.join('|')])
  useEffect(() => {
    if (discovery.status !== 'ready' || !discovery.result.pagination?.next_cursor) return
    cursorByPage.current.set(state.page + 1, discovery.result.pagination.next_cursor)
  }, [discovery, state.page])
  useEffect(() => {
    if (discovery.status !== 'ready' || !location.hash) return
    const target = document.getElementById(location.hash.slice(1))
    if (!target) return
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center' })
      target.querySelector<HTMLAnchorElement>('h2 a')?.focus()
    })
  }, [discovery.status, location.hash])

  useEffect(() => {
    if (!mobileFiltersOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = filterDialogRef.current
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    const focusables = () => [...(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    requestAnimationFrame(() => (focusables()[0] ?? dialog)?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileFiltersOpen(false); requestAnimationFrame(() => filterTriggerRef.current?.focus()); return }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) { event.preventDefault(); dialog?.focus(); return }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKeyDown) }
  }, [mobileFiltersOpen])

  const updateState = (patch: Partial<SearchRouteState>) => setSearchParams(writeSearchState({ ...state, ...patch }))
  const resetTraversal = (patch: Partial<SearchRouteState>) => updateState({ ...patch, page: 1, cursor: null, generation: null })
  const toggleFilter = (filter: string) => resetTraversal({ filters: state.filters.includes(filter) ? state.filters.filter((selected) => selected !== filter) : [...state.filters, filter] })
  const submitEditedSearch = (event: FormEvent) => { event.preventDefault(); resetTraversal({ q: editQuery.trim(), filters: [] }) }
  const closeMobileFilters = () => { setMobileFiltersOpen(false); requestAnimationFrame(() => filterTriggerRef.current?.focus()) }

  const records = catalog?.records ?? []
  const sections = resultSections(records)
  const facets: FacetSectionConfig[] = discovery.status === 'ready' && discovery.result.facets
    ? discovery.result.facets.sections.map((section) => ({ ...section, expandable: section.options.length > 5 }))
    : buildFacetSections(records)
  const pagination = discovery.status === 'ready' ? discovery.result.pagination : null
  const totalMatches = pagination?.total_matches ?? (discovery.status === 'ready' ? discovery.result.total_matches ?? records.length : 0)
  const pageCount = Math.max(1, Math.ceil(totalMatches / (pagination?.page_size ?? PAGE_SIZE)))

  const detailsHref = (record: DatasetRecord) => datasetDetailsHref(record.id, createSearchReturnContext({ pathname: location.pathname, search: location.search }, record.id, typeof window === 'undefined' ? 0 : window.scrollY))
  const changePage = (page: number) => {
    if (page === state.page) return
    const cursor = cursorByPage.current.get(page)
    if (page < state.page && cursor === undefined) { navigate(-1); return }
    if (cursor === undefined) return
    updateState({ page, cursor, generation: pagination?.generation ?? state.generation })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const renderSection = (heading: string, note: string, items: DatasetRecord[], uncertain = false) => {
    if (!items.length) return null
    return <section className={`result-section${uncertain ? ' result-section--uncertain' : ''}`} aria-labelledby={`section-${heading.replace(/\W+/g, '-').toLowerCase()}`}><header><h2 id={`section-${heading.replace(/\W+/g, '-').toLowerCase()}`}>{heading}</h2><p>{note}</p></header>{items.map((result) => <ResultCard id={resultAnchorId(result.id)} key={result.id} result={result} detailsHref={detailsHref(result)} uncertaintyReasons={result.canonicalResult.uncertainty_reasons} />)}</section>
  }

  return (
    <div className="results-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="results-shell">
        <Link className="back-link" to="/">← <span>Back to search</span></Link>
        <div className="results-content">
          <form className="results-query" role="search" onSubmit={submitEditedSearch}><label className="sr-only" htmlFor="results-query-input">Search question</label><div className="results-query__input"><Search aria-hidden="true" /><input id="results-query-input" value={editQuery} placeholder="Ask a health-systems data question, or leave blank to browse" onChange={(event) => setEditQuery(event.target.value)} /></div><button type="submit"><Search aria-hidden="true" /> Search</button></form>

          <aside className="catalog-scope-summary" aria-label="Catalog coverage"><strong>Searching a bounded published catalog</strong><span>Empty results do not establish that no source exists. <Link to="/sources">Review indexed sources and major gaps</Link>.</span></aside>

          {discovery.status === 'ready' && catalog && <>
            <div className="results-overview">
              <div><p className="results-count" aria-live="polite"><strong>{totalMatches}</strong> matching record{totalMatches === 1 ? '' : 's'} · page {state.page} of {pageCount}</p><p className="facet-helper"><Info aria-hidden="true" />Facet counts cover {discovery.result.facets?.collection_scope === 'all_matching_records_before_pagination' ? 'all matching records before pagination' : 'the documented response scope'}{discovery.result.facets?.approximate ? ' and are approximate' : ''}.</p></div>
              <div className="results-toolbar"><label>Sort by:<select value={state.sort} onChange={(event) => resetTraversal({ sort: event.target.value as SearchRouteState['sort'] })}><option value="canonical_relevance">Canonical relevance</option><option value="title_asc">Title A–Z</option><option value="release_newest">Newest publisher release</option><option value="observation_latest">Latest observation coverage</option></select></label><button className="receipt-button" type="button" onClick={() => downloadSearchReceipt(createSearchReceipt(discovery.result, { displayedIds: records.map((record) => record.canonicalResult.record_id) }))}><Download aria-hidden="true" /> Download page receipt</button></div>
            </div>
            <div className="query-evidence" role="note"><p><strong>How this question was interpreted</strong></p><ul>{interpretationLines(discovery.result).map((line) => <li key={line}>{line}</li>)}{discovery.result.query.interpretation.interpretation_warnings?.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>
            {discovery.result.partial_results?.is_partial && <div className="partial-results-notice" role="status"><strong>Partial results</strong><p>{discovery.result.partial_results.invalid_item_count} incompatible catalog record{discovery.result.partial_results.invalid_item_count === 1 ? ' was' : 's were'} omitted. Valid records remain available.</p></div>}
            {discovery.result.named_source_resolution?.filter((source) => source.state === 'coverage_gap').map((source) => <div className="source-gap" role="note" key={source.source_id}><strong>{source.name} is not indexed as a source.</strong><p>{source.message}</p>{source.official_discovery_url && <a href={source.official_discovery_url} target="_blank" rel="noreferrer">Open official discovery page <ExternalLink aria-hidden="true" /></a>}</div>)}
          </>}

          {discovery.status === 'ready' && catalog && <button ref={filterTriggerRef} className="mobile-filter-trigger" type="button" onClick={() => setMobileFiltersOpen(true)}><PanelLeftOpen aria-hidden="true" /> Refine results{state.filters.length > 0 && <span>{state.filters.length}</span>}</button>}

          <div className="results-list" aria-busy={discovery.status === 'loading'}>
            {discovery.status === 'loading' ? <div className="discovery-state" role="status"><span className="discovery-state__spinner" aria-hidden="true" /><h2>{state.q ? 'Searching the Observatory index…' : 'Loading the published catalog…'}</h2><p>No result count is shown until the published response has loaded.</p></div>
              : discovery.status === 'error' ? <div className="discovery-state discovery-state--error" role="alert"><h2>Discovery results are not available.</h2><p>{discovery.error.message}</p>{state.cursor ? <button className="button-link" type="button" onClick={() => resetTraversal({})}>Restart this search</button> : <Link className="button-link" to="/">Revise search</Link>}</div>
                : records.length > 0 ? <>{renderSection('Documented matches', 'These records satisfy the supported interpreted constraints in the published metadata.', sections.supported)}{renderSection('Coverage or access uncertain', 'These records may be relevant, but one or more requested constraints are unknown. They are not confirmed matches.', sections.uncertain, true)}{renderSection('Broader context', 'These records are contextual rather than direct answers to the question.', sections.contextual, true)}</>
                  : state.filters.length > 0 ? <div className="empty-results"><h2>No matching records satisfy these filters.</h2><button type="button" onClick={() => resetTraversal({ filters: [] })}>Clear filters</button></div>
                    : <div className="empty-results"><h2>No indexed source matched this question.</h2><p>This is not evidence that no source exists. Try broader terms or remove a constraint.</p><Link className="button-link" to="/">Revise search</Link></div>}
          </div>

          {discovery.status === 'ready' && <p className="results-footnote"><Info aria-hidden="true" /><span>Results are scoped to catalog generation {pagination?.generation ?? `${discovery.result.corpus.corpus_id} ${discovery.result.corpus.corpus_version}`}. Confirm content, coverage, and access at the publisher source.</span></p>}
          {discovery.status === 'ready' && pageCount > 1 && <Pagination currentPage={state.page} pageCount={pageCount} onChange={changePage} />}
        </div>
        {catalog && <div className="desktop-facets"><FacetSidebar sections={facets} selected={state.filters} onToggle={toggleFilter} onClear={() => resetTraversal({ filters: [] })} /></div>}
        {mobileFiltersOpen && catalog && <div className="filter-overlay" role="presentation" onMouseDown={closeMobileFilters}><div ref={filterDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Refine results" onMouseDown={(event) => event.stopPropagation()}><FacetSidebar sections={facets} mobile selected={state.filters} onToggle={toggleFilter} onClear={() => resetTraversal({ filters: [] })} onClose={closeMobileFilters} /></div></div>}
      </main>
      <ObservatoryFooter results />
    </div>
  )
}
