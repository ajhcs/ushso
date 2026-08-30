import { ExternalLink, Info, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { findDatasetInResponse } from '../lib/catalogAdapter'
import { useDatasetResult } from '../providers/DiscoveryProviderContext'

export function DatasetDetailsPage() {
  const { datasetId = '' } = useParams()
  const discovery = useDatasetResult(datasetId)

  if (discovery.status === 'loading') {
    return (
      <div className="standard-page">
        <ObservatoryHeader compact />
        <main id="main-content" className="standard-page__main discovery-state" aria-busy="true">
          <span className="discovery-state__spinner" aria-hidden="true" />
          <h1>Loading source details…</h1>
          <p>Dereferencing the stable published record and its evidence boundary.</p>
        </main>
        <ObservatoryFooter />
      </div>
    )
  }

  if (discovery.status === 'error') {
    const missing = discovery.error.code === 'record_not_found'
    return (
      <div className="standard-page">
        <ObservatoryHeader compact />
        <main id="main-content" className="standard-page__main discovery-state discovery-state--error" role="alert">
          <h1>{missing ? 'Dataset record not found' : 'Source details are unavailable'}</h1>
          <p>{discovery.error.message}</p>
          <Link className="button-link" to="/search">Browse published sources</Link>
        </main>
        <ObservatoryFooter />
      </div>
    )
  }

  const dataset = findDatasetInResponse(discovery.result, datasetId)
  if (!dataset) return null

  const record = dataset.canonicalResult.record
  return (
    <div className="details-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="details-page__main">
        <Link className="back-link" to="/search">← <span>Browse all published sources</span></Link>
        <div className="details-page__heading">
          <p>{dataset.familyStatus} · {dataset.familySiblingCount} other published record{dataset.familySiblingCount === 1 ? '' : 's'} in this family · {dataset.relationship}</p>
          <h1>{dataset.title}</h1>
          <p>{dataset.description}</p>
        </div>
        <div className="details-grid">
          <section aria-labelledby="details-content-heading">
            <h2 id="details-content-heading">What this source contains</h2>
            <dl className="details-list">
              <div><dt>Why it matched</dt><dd>{dataset.whyMatched}</dd></div>
              <div><dt>Record type</dt><dd>{dataset.recordType}</dd></div>
              <div><dt>Geographic applicability</dt><dd>{dataset.geographicApplicability}</dd></div>
              <div><dt>Reporting unit</dt><dd>{dataset.reportingUnit}</dd></div>
              <div><dt>Population/facility scope</dt><dd>{dataset.populationFacilityScope}</dd></div>
              <div><dt>Available years</dt><dd>{dataset.availableYears}</dd></div>
              <div><dt>Latest verified release</dt><dd>{dataset.latestVerifiedRelease}</dd></div>
              <div><dt>Expected documentation</dt><dd>{dataset.variablesCodebook}</dd></div>
              <div><dt>Metadata observed</dt><dd>{record.freshness_verification.metadata_observed_at}</dd></div>
              <div><dt>Known limitations</dt><dd>{record.evidence.flatMap((item) => item.limitations).join(' · ') || 'No limitation statement was captured.'}</dd></div>
            </dl>
          </section>
          <aside className="details-access" aria-labelledby="details-access-heading">
            <h2 id="details-access-heading">Access and requirements</h2>
            <p className="details-access__summary">Status: <strong>{record.access.status.replaceAll('_', ' ')}</strong>. {record.access.restriction_note ?? 'No additional restriction note was captured.'}</p>
            {dataset.accessOptions.map((option) => (
              <div className="details-access__path" key={option.id}>
                <h3>{option.label}</h3>
                <p>{option.description}</p>
                {option.requirements.length > 0 && <p><b>Requirements:</b> {option.requirements.join(', ')}</p>}
                {option.href ? (
                  <a href={option.href} target="_blank" rel="noreferrer">Open this step at the authoritative source <ExternalLink aria-hidden="true" /></a>
                ) : (
                  <p className="unresolved-link"><Info aria-hidden="true" />This step has no verified direct URL.</p>
                )}
              </div>
            ))}
          </aside>
        </div>

        <section className="join-routes" aria-labelledby="join-routes-heading">
          <h2 id="join-routes-heading">Documented join routes</h2>
          <p>Join routes are evidence-bearing candidates, not permission to merge identities. Check keys, cardinality, prerequisites, and caveats before analysis.</p>
          {dataset.joinRoutes.length === 0 ? (
            <div className="join-route"><h3>No route returned for this record</h3><p>{record.join_compatibility.notes.join(' · ') || 'Join compatibility is unknown.'}</p></div>
          ) : dataset.joinRoutes.map((route) => (
            <article className="join-route" key={route.route_id}>
              <h3>{route.entity}: {route.compatibility_state}</h3>
              <dl>
                <div><dt>Route</dt><dd>{route.from_record_id} → {route.to_record_id}</dd></div>
                <div><dt>Strategy</dt><dd>{route.match_strategy}</dd></div>
                <div><dt>Cardinality</dt><dd>{route.cardinality}</dd></div>
                <div><dt>Confidence</dt><dd>{route.confidence}</dd></div>
                <div><dt>Keys</dt><dd>{route.key_pairs.map((pair) => `${pair.from_namespace} [${pair.from_fields.join(', ')}] → ${pair.to_namespace} [${pair.to_fields.join(', ')}]`).join(' · ') || 'No key pair documented.'}</dd></div>
                <div><dt>Prerequisites</dt><dd>{route.preconditions.join(' · ') || 'None documented.'}</dd></div>
                <div><dt>Caveats</dt><dd>{route.caveats.join(' · ') || 'None documented.'}</dd></div>
                {route.blocked_reason && <div><dt>Blocked reason</dt><dd>{route.blocked_reason}</dd></div>}
              </dl>
            </article>
          ))}
        </section>

        <section className="canonical-evidence" aria-labelledby="canonical-evidence-heading">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2 id="canonical-evidence-heading">Canonical discovery provenance</h2>
            <p>This stable page preserves the record’s access, provenance, freshness, retrieval, and join-compatibility fields. It is rendered from the same contract used by machine clients.</p>
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
