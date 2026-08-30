import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DatasetFamily } from '../types/catalog'

interface ResultCardProps {
  result: DatasetFamily
}

export function ResultCard({ result }: ResultCardProps) {
  const categories = result.categories.filter(Boolean).slice(0, 3)

  return (
    <article className="result-card" data-result-id={result.id}>
      <div className="result-card__main">
        <h2><Link to={result.detailsUrl}>{result.title}</Link></h2>
        <p className="result-card__description">{result.description}</p>
        {categories.length > 0 && (
          <ul className="result-card__categories">
            {categories.map((category) => <li key={category}>{category}</li>)}
          </ul>
        )}
        <dl className="result-card__facts">
          <div>
            <dt>Geography</dt>
            <dd>{result.geographicApplicability}</dd>
          </div>
          <div>
            <dt>Grain</dt>
            <dd>{result.grain}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{result.availableYears}</dd>
          </div>
        </dl>
      </div>
      <div className="result-card__action">
        <p className={result.verification.liveVerified ? 'verification-state verification-state--current' : 'verification-state'}>
          <ShieldCheck aria-hidden="true" />
          <span>
            <b>{result.verification.liveVerified ? 'Live verified' : 'Verification pending'}</b>
            <small>{result.accessStatusLabel}</small>
          </span>
        </p>
        <Link className="view-details" to={result.detailsUrl}>View details</Link>
      </div>
    </article>
  )
}
