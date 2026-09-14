import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { MouseEventHandler } from 'react'
import type { DatasetFamily } from '../types/catalog'

interface ResultCardProps {
  result: DatasetFamily
  id?: string
  displayRank?: number
  detailsHref?: string
  onDetailsClick?: MouseEventHandler<HTMLAnchorElement>
  uncertaintyReasons?: string[]
}

function formatChecked(value: string | null | undefined) {
  if (!value) return 'unknown'
  const checked = new Date(value)
  return Number.isNaN(checked.getTime()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(checked)
}

function payloadCheckStateLabel(state: string | undefined) {
  if (!state || state === 'not_attempted') return 'not attempted'
  return state.replaceAll('_', ' ')
}

function freshnessPresentation(result: DatasetFamily) {
  const projected = result.canonicalResult.metadata?.freshness
  const verification = result.verification
  return {
    lastSuccessfulText: formatChecked(verification.lastSuccessfulMetadataCheck),
    latestAttemptText: formatChecked(verification.latestAttemptAt),
    latestAttemptOutcome: (verification.latestAttemptOutcome ?? 'unknown').replaceAll('_', ' '),
    payloadCheckState: payloadCheckStateLabel(verification.payloadCheckState ?? projected?.payload_check?.state),
    payloadCheck: verification.payloadCheckNote ?? projected?.payload_check?.note ?? 'Catalog metadata observation is not a payload-access check.',
    stale: verification.staleStatus === 'stale_historical_success' || verification.status === 'stale' || projected?.stale_status === 'stale_historical_success',
    overdue: projected?.freshness_state === 'overdue' || verification.freshnessState === 'overdue',
  }
}

function hasEncodingDamage(value: string) {
  return /\uFFFD|(?:Ã.|Â.|â€|â€™|â€œ|â€)/u.test(value)
}

function matchStatus(result: DatasetFamily) {
  switch (result.canonicalResult.match_state) {
    case 'uncertain': return 'Uncertain match'
    case 'contextual': return 'Broader context'
    case 'incompatible': return 'Incompatible'
    default: return 'Documented match'
  }
}

export function ResultCard({ result, id, displayRank, detailsHref = result.detailsUrl, onDetailsClick, uncertaintyReasons = [] }: ResultCardProps) {
  const categoryDetails = result.canonicalResult.record.capabilities.topics.filter((topic) => topic.label).slice(0, 3)
  const freshness = freshnessPresentation(result)
  const metadata = result.canonicalResult.metadata
  const description = metadata?.description_quality?.display_description ?? result.description
  const corrupted = metadata?.description_quality?.state === 'suspected_encoding_corruption' || (!metadata?.description_quality && hasEncodingDamage(result.description))
  const observationGrain = result.grain
  const observationPeriod = metadata?.dates?.observation_period
  const observationTime = observationPeriod ? [observationPeriod.start, observationPeriod.end].filter(Boolean).join('–') || observationPeriod.state : result.availableYears
  const whyMatched = result.relevance === 'Browse'
    ? 'Published catalog browse; no research objective was inferred.'
    : result.canonicalResult.relevance.why_relevant[0] ?? 'No evidence-backed match explanation is available.'
  const verificationTarget = result.verification.liveVerified
    ? 'Scoped metadata route checked'
    : result.verification.status === 'stale'
      ? 'Metadata route check is stale'
      : 'Metadata route not live checked'

  return (
    <article id={id} className="result-card" data-result-id={result.id} aria-label={displayRank ? `Result ${displayRank}: ${result.title}` : undefined}>
      <div className="result-card__main">
        <p className="result-card__source" data-result-region="source">{result.sourceName}{result.familyStatus === "Family" ? ` · ${result.familySiblingCount + 1} related records` : ""}</p>
        <h2 data-result-region="title"><Link to={detailsHref} onClick={onDetailsClick}>{result.title}</Link></h2>
        <p className="result-card__description" data-result-region="description">{description}</p>
        {metadata?.named_source_role === 'secondary_mention' && <p className="result-card__source-role">Secondary mention—not the requested source</p>}
        {corrupted && <p className="result-card__quality"><AlertTriangle aria-hidden="true" />Captured description may contain encoding damage; inspect the source.</p>}
        {uncertaintyReasons.length > 0 && <div className="result-card__uncertainty"><strong>Why this is uncertain</strong><ul>{uncertaintyReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
        <div className="result-card__why" data-result-region="why-match"><h3>Purpose</h3><p>{whyMatched}</p></div>
        {categoryDetails.length > 0 && (
          <ul className="result-card__categories">
            {categoryDetails.map((category) => <li key={category.id || category.label}>{category.label}{category.evidence_state === 'inferred' && <small>Inferred search aid</small>}</li>)}
          </ul>
        )}
        <dl className="result-card__coverage" data-result-region="geo-grain-time">
          <div>
            <dt>Geography</dt>
            <dd>{result.geographicApplicability}</dd>
          </div>
          <div>
            <dt>Grain</dt>
            <dd>{observationGrain}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{observationTime}</dd>
          </div>
          {metadata?.dates?.publisher_release_date && <div><dt>Publisher release</dt><dd>{metadata.dates.publisher_release_date}</dd></div>}
        </dl>
      </div>
      <aside className="result-card__summary" aria-label="Verification and access status">
        <div className="result-card__evidence-access" data-result-region="access-evidence">
          <p className="result-status"><span><small>Question match</small><strong>{matchStatus(result)}</strong></span></p>
                    <p className={result.verification.liveVerified ? 'result-status result-status--verified' : 'result-status'}>
            <ShieldCheck aria-hidden="true" />
            <span>
              <small>Tested access</small>
              <strong>{result.accessStatusLabel}</strong>
              {freshness.overdue && <em>Review overdue</em>}
              {freshness.stale && <em>Historical metadata success is stale</em>}
              <small>{verificationTarget}</small>
            </span>
          </p>
        </div>
        <details className="result-card__evidence">
          <summary>Evidence and generation details</summary>
          <p>Last successful metadata check {freshness.lastSuccessfulText}</p>
          <p>Latest catalog-metadata attempt {freshness.latestAttemptText} ({freshness.latestAttemptOutcome})</p>
          <p>Payload check {freshness.payloadCheckState}. {freshness.payloadCheck}</p>
          <p>Catalog generation and ranking hashes stay on the results page receipt, not this card.</p>
        </details>
        <Link className="view-details" data-result-region="details-action" to={detailsHref} onClick={onDetailsClick}>Open access route</Link>
      </aside>
    </article>
  )
}
