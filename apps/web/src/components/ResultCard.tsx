import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DatasetFamily } from '../types/catalog'

interface ResultCardProps {
  result: DatasetFamily
  id?: string
  detailsHref?: string
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

export function ResultCard({ result, id, detailsHref = result.detailsUrl, uncertaintyReasons = [] }: ResultCardProps) {
  const categoryDetails = result.canonicalResult.record.capabilities.topics.filter((topic) => topic.label).slice(0, 3)
  const freshness = checkedLabel(result)
  const metadata = result.canonicalResult.metadata
  const description = metadata?.description_quality.display_description ?? result.description
  const corrupted = metadata ? metadata.description_quality.state === 'suspected_encoding_corruption' : hasEncodingDamage(result.description)
  const observationGrain = metadata?.dimensions.observation_grain.values.map((value) => value.replaceAll('_', ' ')).join(', ') || result.grain
  const observationPeriod = metadata?.dates.observation_period
  const observationTime = observationPeriod ? [observationPeriod.start, observationPeriod.end].filter(Boolean).join('–') || observationPeriod.state : result.availableYears

  return (
    <article id={id} className="result-card" data-result-id={result.id}>
      <div className="result-card__main">
        <h2><Link to={detailsHref}>{result.title}</Link></h2>
        <p className="result-card__description">{description}</p>
        {metadata?.named_source_role === 'secondary_mention' && <p className="result-card__source-role">Secondary mention—not the requested source</p>}
        {corrupted && <p className="result-card__quality"><AlertTriangle aria-hidden="true" />Captured description may contain encoding damage; inspect the source.</p>}
        {uncertaintyReasons.length > 0 && <div className="result-card__uncertainty"><strong>Why this is uncertain</strong><ul>{uncertaintyReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
        {categoryDetails.length > 0 && (
          <ul className="result-card__categories">
            {categoryDetails.map((category) => <li key={category.id || category.label}>{category.label}{category.evidence_state === 'inferred' && <small>Inferred search aid</small>}</li>)}
          </ul>
        )}
        <dl className="result-card__facts">
          <div>
            <dt>Geography</dt>
            <dd>{result.geographicApplicability}</dd>
          </div>
          <div>
            <dt>Observation grain</dt>
            <dd>{observationGrain}</dd>
          </div>
          <div>
            <dt>Observation period</dt>
            <dd>{observationTime}</dd>
          </div>
          {metadata?.dates.publisher_release_date && <div><dt>Publisher release</dt><dd>{metadata.dates.publisher_release_date}</dd></div>}
        </dl>
      </div>
      <div className="result-card__action">
        <p className={result.verification.liveVerified ? 'verification-state verification-state--current' : 'verification-state'}>
          <ShieldCheck aria-hidden="true" />
          <span>
            <b>{result.verification.liveVerified ? 'Live verified' : 'Verification pending'}</b>
            {freshness.overdue && <em>Review overdue</em>}
            <small>Last checked {freshness.checkedText}</small>
            <small>{result.accessStatusLabel}</small>
          </span>
        </p>
        <Link className="view-details" to={detailsHref}>View details</Link>
      </div>
    </article>
  )
}
