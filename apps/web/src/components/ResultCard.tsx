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

function checkedLabel(result: DatasetFamily) {
  const metadataFreshness = result.canonicalResult.metadata?.freshness
  if (metadataFreshness) {
    const checked = metadataFreshness.last_checked ? new Date(metadataFreshness.last_checked) : null
    return {
      checkedText: !checked || Number.isNaN(checked.getTime()) ? metadataFreshness.last_checked ?? 'unknown' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(checked),
      overdue: metadataFreshness.freshness_state === 'overdue',
    }
  }
  const checked = new Date(result.verification.metadataObservedAt)
  const checkedText = Number.isNaN(checked.getTime()) ? result.verification.metadataObservedAt : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(checked)
  const due = result.verification.nextReviewDue ? new Date(result.verification.nextReviewDue).getTime() : null
  const overdue = due !== null && Number.isFinite(due) && Date.now() > due
  return { checkedText, overdue }
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
  const freshness = checkedLabel(result)
  const metadata = result.canonicalResult.metadata
  const description = metadata?.description_quality.display_description ?? result.description
  const corrupted = metadata ? metadata.description_quality.state === 'suspected_encoding_corruption' : hasEncodingDamage(result.description)
  const observationGrain = metadata?.dimensions.observation_grain.values.map((value) => value.replaceAll('_', ' ')).join(', ') || result.grain
  const observationPeriod = metadata?.dates.observation_period
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
        <h2 data-result-region="title"><Link to={detailsHref} onClick={onDetailsClick}>{result.title}</Link></h2>
        <p className="result-card__description" data-result-region="description">{description}</p>
        {metadata?.named_source_role === 'secondary_mention' && <p className="result-card__source-role">Secondary mention—not the requested source</p>}
        {corrupted && <p className="result-card__quality"><AlertTriangle aria-hidden="true" />Captured description may contain encoding damage; inspect the source.</p>}
        {uncertaintyReasons.length > 0 && <div className="result-card__uncertainty"><strong>Why this is uncertain</strong><ul>{uncertaintyReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
        <div className="result-card__why" data-result-region="why-match"><h3>Why it matched</h3><p>{whyMatched}</p></div>
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
          {metadata?.dates.publisher_release_date && <div><dt>Publisher release</dt><dd>{metadata.dates.publisher_release_date}</dd></div>}
        </dl>
      </div>
      <aside className="result-card__summary" aria-label="Verification and access status">
        <div className="result-card__evidence-access" data-result-region="access-evidence">
          <p className="result-status"><span><small>Question match</small><strong>{matchStatus(result)}</strong></span></p>
          <p className={result.verification.liveVerified ? 'result-status result-status--verified' : 'result-status'}>
            <ShieldCheck aria-hidden="true" />
            <span>
              <small>Verification target</small>
              <strong>{verificationTarget}</strong>
              {freshness.overdue && <em>Review overdue</em>}
              <small>Last checked {freshness.checkedText}</small>
            </span>
          </p>
          <p className="result-status"><span><small>Access</small><strong>{result.accessStatusLabel}</strong></span></p>
        </div>
        <Link className="view-details" data-result-region="details-action" to={detailsHref} onClick={onDetailsClick}>View evidence and access</Link>
      </aside>
    </article>
  )
}
