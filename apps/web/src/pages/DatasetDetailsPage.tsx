import { ExternalLink, Info, ShieldCheck } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { findDatasetInResponse } from '../lib/catalogAdapter'
import { DEMO_QUERY } from '../lib/uiSearch'
import { useDiscoveryResult } from '../providers/DiscoveryProviderContext'

export function DatasetDetailsPage() {
  const { datasetId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')?.trim() || DEMO_QUERY
  const discovery = useDiscoveryResult(query)

  if (discovery.status === 'loading') {
    return (
      <div className="standard-page">
        <ObservatoryHeader compact />
        <main id="main-content" className="standard-page__main discovery-state" aria-busy="true">
          <span className="discovery-state__spinner" aria-hidden="true" />
          <h1>Loading source details…</h1>
          <p>Retrieving the canonical record and its evidence boundary.</p>
        </main>
        <ObservatoryFooter />
      </div>
    )
  }

  if (discovery.status === 'error') {
    return (
      <div className="standard-page">
        <ObservatoryHeader compact />
        <main id="main-content" className="standard-page__main discovery-state discovery-state--error" role="alert">
          <h1>Source details are unavailable</h1>
          <p>{discovery.error.message}</p>
          <Link className="button-link" to={`/?q=${encodeURIComponent(query)}`}>Revise search</Link>
        </main>
        <ObservatoryFooter />
      </div>
    )
  }

  const dataset = findDatasetInResponse(discovery.result, datasetId)

  if (!dataset) {
    return (
      <div className="standard-page">
        <ObservatoryHeader compact />
        <main id="main-content" className="standard-page__main">
          <h1>Dataset details not found</h1>
          <p>This record was not returned for the current question.</p>
          <Link className="button-link" to={`/search?q=${encodeURIComponent(query)}`}>Return to results</Link>
        </main>
        <ObservatoryFooter />
      </div>
    )
  }

  const record = dataset.canonicalResult.record
  return (
    <div className="details-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="details-page__main">
        <Link className="back-link" to={`/search?q=${encodeURIComponent(query)}`}>← <span>Back to results</span></Link>
        <div className="details-page__heading">
          <p>{dataset.familyStatus} · Relevance: {dataset.relevance} · {dataset.relationship}</p>
          <h1>{dataset.title}</h1>
          <p>{dataset.description}</p>
        </div>
        <div className="details-grid">
          <section aria-labelledby="details-content-heading">
            <h2 id="details-content-heading">Content and coverage</h2>
            <dl className="details-list">
              <div><dt>Why it matched</dt><dd>{dataset.whyMatched}</dd></div>
              <div><dt>Record type</dt><dd>{dataset.recordType}</dd></div>
              <div><dt>Geographic applicability</dt><dd>{dataset.geographicApplicability}</dd></div>
              <div><dt>Reporting unit</dt><dd>{dataset.reportingUnit}</dd></div>
              <div><dt>Population/facility scope</dt><dd>{dataset.populationFacilityScope}</dd></div>
              <div><dt>Available years</dt><dd>{dataset.availableYears}</dd></div>
              <div><dt>Latest verified release</dt><dd>{dataset.latestVerifiedRelease}</dd></div>
              <div><dt>Variables/codebook</dt><dd>{dataset.variablesCodebook}</dd></div>
            </dl>
          </section>
          <aside className="details-access" aria-labelledby="details-access-heading">
            <h2 id="details-access-heading">Access and requirements</h2>
            {dataset.accessOptions.map((option) => (
              <div className="details-access__path" key={option.id}>
                <h3>{option.label}</h3>
                <p>{option.description}</p>
                {option.requirements.length > 0 && <p><b>Requirements:</b> {option.requirements.join(', ')}</p>}
                {option.href ? (
                  <a href={option.href} target="_blank" rel="noreferrer">Open authoritative source <ExternalLink aria-hidden="true" /></a>
                ) : (
                  <p className="unresolved-link"><Info aria-hidden="true" />Authoritative source URL pending verification.</p>
                )}
              </div>
            ))}
          </aside>
        </div>
        <section className="canonical-evidence" aria-labelledby="canonical-evidence-heading">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2 id="canonical-evidence-heading">Canonical discovery provenance</h2>
            <p>This page preserves the discovery response’s access, provenance, freshness, retrieval, and join-compatibility fields. It is rendered from the same contract prepared for machine clients.</p>
            <dl>
              <div><dt>Asset ID</dt><dd>{dataset.canonicalResult.record_id}</dd></div>
              <div><dt>Evidence state</dt><dd>{[...new Set(record.evidence.map((item) => item.state))].join(', ')}</dd></div>
              <div><dt>Freshness state</dt><dd>{record.freshness_verification.verification_status}</dd></div>
              <div><dt>Retrieval interface</dt><dd>{record.retrieval.preferred_interface}</dd></div>
              <div><dt>Documented join routes</dt><dd>{dataset.joinRoutes.length}</dd></div>
            </dl>
          </div>
        </section>
      </main>
      <ObservatoryFooter results />
    </div>
  )
}
