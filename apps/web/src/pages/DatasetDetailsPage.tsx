import { ExternalLink, Info, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { ResearcherDecisionSummary } from '../components/ResearcherDecisionSummary'
import { findDatasetInResponse } from '../lib/catalogAdapter'
import { safeExternalHttpsUrl } from '../lib/externalUrls'
import { useDatasetResult } from '../providers/DiscoveryProviderContext'

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

function sentenceCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

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
  const verificationEvidence = dataset.verification.evidence.filter((item) => item.state === 'verified_first_party' && item.sources.length > 0)
  const codebookUrl = dataset.variableDetails.codebook
    ? safeExternalHttpsUrl(dataset.variableDetails.codebook.url)
    : null
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
        <ResearcherDecisionSummary dataset={dataset} />
        <div className="details-grid">
          <section aria-labelledby="details-content-heading">
            <h2 id="details-content-heading">Content and coverage</h2>
            <dl className="details-list">
              <div><dt>Record type</dt><dd>{dataset.recordType}</dd></div>
              <div><dt>Geographic applicability</dt><dd>{dataset.geographicApplicability}</dd></div>
              <div><dt>Reporting unit</dt><dd>{dataset.reportingUnit}</dd></div>
              <div><dt>Population/facility scope</dt><dd>{dataset.populationFacilityScope}</dd></div>
              <div><dt>Available years</dt><dd>{dataset.availableYears}</dd></div>
              <div><dt>Data through</dt><dd>{dataset.verification.dataThrough ?? 'Not stated by the source metadata'}</dd></div>
              <div><dt>Variable documentation</dt><dd>{sentenceCase(dataset.variableDetails.status)}{dataset.variableDetails.variableCount !== null ? ` · ${dataset.variableDetails.variableCount} fields` : ''}</dd></div>
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
                  <a href={option.href} target="_blank" rel="noreferrer">Open authoritative source <ExternalLink aria-hidden="true" /></a>
                ) : (
                  <p className="unresolved-link"><Info aria-hidden="true" />Authoritative source URL pending verification.</p>
                )}
              </div>
            ))}
          </aside>
        </div>
        <div className="details-evidence-grid">
          <section className="details-panel" aria-labelledby="verification-heading">
            <div className="details-panel__heading">
              <ShieldCheck aria-hidden="true" />
              <div>
                <p className="details-panel__eyebrow">{dataset.verification.liveVerified ? 'Scoped metadata route checked' : 'Scoped metadata route not live checked'}</p>
                <h2 id="verification-heading">Verification evidence</h2>
              </div>
            </div>
            <dl className="details-list">
              <div><dt>Metadata checked</dt><dd><time dateTime={dataset.verification.metadataObservedAt}>{formatDate(dataset.verification.metadataObservedAt)}</time></dd></div>
              <div><dt>Method</dt><dd>{sentenceCase(dataset.verification.method)}</dd></div>
              <div><dt>Data coverage</dt><dd>{dataset.verification.dataThrough ?? dataset.availableYears}</dd></div>
            </dl>
            <div className="evidence-claims">
              {verificationEvidence.map((evidence) => (
                <article key={evidence.evidenceId}>
                  <p>{evidence.claim}</p>
                  <ul>
                    {evidence.sources.map((source) => {
                      const canonicalLocator = safeExternalHttpsUrl(source.locator)
                      return (
                        <li key={source.provenanceId}>
                          {canonicalLocator ? (
                            <a href={canonicalLocator} target="_blank" rel="noreferrer">
                            {source.kind === 'first_party_page' ? 'Open first-party source' : 'Open supporting documentation'} <ExternalLink aria-hidden="true" />
                            </a>
                          ) : <span>Non-navigable evidence locator retained: {source.locator}</span>}
                        </li>
                      )
                    })}
                  </ul>
                  {evidence.limitations.length > 0 && <p className="evidence-limit"><b>Boundary:</b> {evidence.limitations.join(' ')}</p>}
                </article>
              ))}
            </div>
          </section>

          <section className="details-panel" aria-labelledby="variables-heading">
            <div className="details-panel__heading">
              <Info aria-hidden="true" />
              <div>
                <p className="details-panel__eyebrow">Backend-maintained field guide</p>
                <h2 id="variables-heading">Variables and what they mean</h2>
              </div>
            </div>
            {dataset.variableDetails.summary && <p className="variable-summary">{dataset.variableDetails.summary}</p>}
            <dl className="variable-list">
              {dataset.variableDetails.variables.map((variable) => (
                <div key={variable.name}>
                  <dt>{variable.label ?? variable.name}</dt>
                  <dd>
                    <p>{variable.description}</p>
                    <small>{[variable.data_type, variable.unit].filter(Boolean).join(' · ') || 'Source-defined field'}</small>
                    {variable.allowed_values.length > 0 && <small>Values: {variable.allowed_values.join(', ')}</small>}
                  </dd>
                </div>
              ))}
            </dl>
            {dataset.variableDetails.codebook && codebookUrl && (
              <a className="codebook-link" href={codebookUrl} target="_blank" rel="noreferrer">
                Open {dataset.variableDetails.codebook.title} <ExternalLink aria-hidden="true" />
              </a>
            )}
            {dataset.variableDetails.limitations.length > 0 && <p className="evidence-limit"><b>Interpretation limits:</b> {dataset.variableDetails.limitations.join(' ')}</p>}
          </section>
        </div>
        <section className="join-routes" aria-labelledby="join-routes-heading">
          <h2 id="join-routes-heading">Documented join routes</h2>
          <p>These routes describe published compatibility evidence. Candidate or ambiguous routes still require validation before analysis.</p>
          {dataset.joinRoutes.length === 0 ? (
            <div className="join-route"><p>No join route is documented for this record.</p></div>
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
              <div><dt>Verification state</dt><dd>{sentenceCase(record.freshness_verification.verification_status)}</dd></div>
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
