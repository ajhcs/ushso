import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LiveCatalogPositioning } from '../components/LiveCatalogPositioning'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { normalizeFacetValue } from '../data/facets'
import { useDiscoveryResult } from '../providers/DiscoveryProviderContext'

interface ReadinessState {
  name: string
  postal: string
  fips: string
  federal_record_count: number
  state_overlay_status: string
  overlay_readiness_status: string
  candidate_record_count: number
  published_state_record_count: number
  interpretation: string
  next_step: string
}

interface NationalReadiness {
  corpus_version: string
  summary: { jurisdictions: number; federal_sources_live_metadata_validated: number; published_records: number }
  states: ReadinessState[]
  limitations: string[]
}

function overlayLabel(state: ReadinessState) {
  if (state.state_overlay_status === 'published_dense_overlay') return `${state.published_state_record_count} state records published`
  if (state.overlay_readiness_status.includes('navigation_only')) return `${state.candidate_record_count} navigation candidates; asset depth unverified`
  if (state.state_overlay_status === 'candidate_available') return `${state.candidate_record_count} candidates awaiting integration review`
  return 'Bounded evidence gap; not an absence claim'
}

export function SourcesPage() {
  const discovery = useDiscoveryResult('')
  const [readiness, setReadiness] = useState<NationalReadiness | null>(null)
  const [readinessError, setReadinessError] = useState(false)
  const catalog = useMemo(() => discovery.status === 'ready' ? adaptDiscoveryResponse(discovery.result) : null, [discovery])
  const sourceGroups = useMemo(() => {
    if (discovery.status !== 'ready') return []
    const sourceFacet = discovery.result.facets?.sections.find((section) => section.id === 'source')
    if (sourceFacet) return sourceFacet.options.map((option) => ({
      id: option.value,
      label: option.label,
      count: option.count,
      examples: (catalog?.records ?? []).filter((record) => normalizeFacetValue(record.canonicalResult.record.identity.source.source_id) === normalizeFacetValue(option.value)),
    }))
    const groups = new Map<string, NonNullable<typeof catalog>['records']>()
    for (const record of catalog?.records ?? []) groups.set(record.sourceName, [...(groups.get(record.sourceName) ?? []), record])
    return [...groups.entries()].map(([label, examples]) => ({ id: label, label, count: examples.length, examples }))
  }, [catalog, discovery])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/state-readiness-v0.1.0.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('readiness unavailable')
      setReadiness(await response.json() as NationalReadiness)
    }).catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setReadinessError(true)
    })
    return () => controller.abort()
  }, [])

  return (
    <div className="sources-page">
      <PageTitle label="Catalog coverage and sources" />
      <ObservatoryHeader compact />
      <main id="main-content" className="sources-page__main">
        <header className="sources-page__heading">
          <p>Published source inventory</p>
          <h1>What USHSO can route you to</h1>
          <p>The catalog describes authoritative sources and their access routes. “Published” means the metadata passed the integration gate; it does not mean USHSO hosts the data or that every endpoint is currently accessible.</p>
          <p className="coverage-boundary"><strong>Coverage boundary:</strong> this inventory is a bounded set of catalog entries, not a census of United States health data. Record counts below describe indexed metadata; they are not counts of sources assessed as usable for a research question.</p>
          <Link className="button-link" to="/search">Browse all records</Link>
        </header>

        <LiveCatalogPositioning />

        {readiness && (
          <section className="readiness" aria-labelledby="readiness-heading">
            <h2 id="readiness-heading">National readiness</h2>
            <div className="readiness__summary">
              <div><strong>{readiness.summary.jurisdictions}</strong><span>states plus DC recognized</span></div>
              <div><strong>{readiness.summary.federal_sources_live_metadata_validated}</strong><span>federal source routes live metadata-checked</span></div>
              <div><strong>{readiness.summary.published_records}</strong><span>published records in corpus v{readiness.corpus_version}</span></div>
            </div>
            <p>The readiness artifact reports indexed federal routes separately from state overlays. A national source is not automatically documented as suitable for state-level analysis, and a navigation candidate is not a validated dataset.</p>
            <div className="readiness-table-wrap">
              <table className="readiness-table">
                <thead><tr><th scope="col">Jurisdiction</th><th scope="col">Federal baseline</th><th scope="col">State overlay</th><th scope="col">Status meaning</th></tr></thead>
                <tbody>{readiness.states.map(state => (
                  <tr key={state.postal}>
                    <th scope="row">{state.name} <span>{state.postal} · FIPS {state.fips}</span></th>
                    <td>{state.federal_record_count} validated metadata routes</td>
                    <td>{overlayLabel(state)}</td>
                    <td><details><summary>Read boundary</summary><p>{state.interpretation}</p><p><strong>Next:</strong> {state.next_step}</p></details></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <ul className="readiness__limitations">{readiness.limitations.map(item => <li key={item}>{item}</li>)}</ul>
          </section>
        )}
        {readinessError && <p className="status-note" role="alert">The state-readiness artifact could not be loaded. The published catalog remains available below.</p>}

        <section className="source-inventory" aria-labelledby="source-inventory-heading">
          <h2 id="source-inventory-heading">Authoritative sources in the published corpus</h2>
          {discovery.status === 'loading' && <p role="status">Loading the published source inventory…</p>}
          {discovery.status === 'error' && <p role="alert">{discovery.error.message}</p>}
          <div className="source-inventory__grid">
            {sourceGroups.map((source) => (
              <article className="source-group" key={source.id}>
                <p>Indexed source</p>
                <h3>{source.label}</h3>
                <span>{source.count} catalog record{source.count === 1 ? '' : 's'} across the full pre-pagination inventory</span>
                {source.examples.length > 0 && <><p className="source-group__examples">Examples on the currently loaded page:</p><ul>{source.examples.slice(0, 3).map(record => <li key={record.id}><Link to={record.detailsUrl}>{record.title}</Link></li>)}</ul></>}
              </article>
            ))}
          </div>
        </section>

        <section className="coverage-method" aria-labelledby="coverage-method-heading">
          <h2 id="coverage-method-heading">What is included—and what is not</h2>
          <div className="coverage-method__grid">
            <div>
              <h3>Publication criteria</h3>
              <p>A record needs a source-native identity, preserved provenance, an explicit access state, and compatibility with the public discovery contract. Inclusion does not prove payload access, authorization, complete documentation, join compatibility, or research fitness.</p>
            </div>
            <div>
              <h3>Important current gaps</h3>
              <p>Many state agencies, local systems, private and licensed collections, research repositories, clinical networks, and source products named by researchers are not indexed. Unknown coverage remains unknown; empty search results are scoped only to this generation.</p>
            </div>
          </div>
          <p>Named sources such as HCUP, MEPS, PHC4, or the AHRQ Compendium must be represented by their own records to count as indexed. A secondary citation does not stand in for the requested source.</p>
          <p><Link to="/methods">Read the catalog and evaluation methods</Link>.</p>
        </section>
      </main>
      <ObservatoryFooter results />
    </div>
  )
}
