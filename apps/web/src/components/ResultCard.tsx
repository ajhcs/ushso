import {
  Building2,
  CalendarDays,
  ExternalLink,
  MapPin,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DatasetFamily } from '../types/catalog'

interface ResultCardProps {
  result: DatasetFamily
  displayRank: number
}

export function ResultCard({ result, displayRank }: ResultCardProps) {
  const coverage = [
    { label: 'Geography', value: result.geographicApplicability, Icon: MapPin },
    { label: 'Grain', value: result.reportingUnit, Icon: Building2 },
    { label: 'Time', value: result.availableYears, Icon: CalendarDays },
  ]
  const categories = result.categories.slice(0, 3)
  const whyMatched = result.relevance === 'Browse'
    ? 'Published catalog browse; no research objective was inferred.'
    : result.canonicalResult.relevance.why_relevant[0] ?? 'No evidence-backed match explanation is available.'
  const verificationTarget = result.verification.liveVerified
    ? 'Scoped metadata route checked'
    : result.verification.status === 'stale'
      ? 'Metadata route check is stale'
      : 'Metadata route not live checked'

  return (
    <article className="result-card" data-result-id={result.id} aria-label={`Result ${displayRank}: ${result.title}`}>
      <div className="result-card__main">
        <h2 data-result-region="title">{result.title}</h2>
        <p className="result-card__description" data-result-region="description">{result.description}</p>
        <div className="result-card__why" data-result-region="why-match">
          <h3>Why it matched</h3>
          <p>{whyMatched}</p>
          {categories.length > 0 && (
            <ul className="result-card__categories" aria-label="Data categories">
              {categories.map((category) => <li key={category}>{category}</li>)}
            </ul>
          )}
        </div>
        <dl className="result-card__coverage" data-result-region="geo-grain-time">
          {coverage.map(({ label, value, Icon }) => (
            <div key={label}>
              <Icon aria-hidden="true" />
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <aside className="result-card__summary" aria-label="Verification and access status">
        <div className="result-card__evidence-access" data-result-region="access-evidence">
          <p className={result.verification.liveVerified ? 'result-status result-status--verified' : 'result-status'}>
            <ShieldCheck aria-hidden="true" />
            <span><small>Verification target</small><strong>{verificationTarget}</strong></span>
          </p>
          <p className="result-status">
            <ExternalLink aria-hidden="true" />
            <span><small>Access</small><strong>{result.accessStatus}</strong></span>
          </p>
        </div>
        <Link className="view-details" data-result-region="details-action" to={result.detailsUrl}>View evidence and access <ExternalLink aria-hidden="true" /></Link>
      </aside>
    </article>
  )
}
