import {
  BarChart3,
  BriefcaseMedical,
  Building2,
  CalendarDays,
  Code2,
  Download,
  ExternalLink,
  FileBarChart,
  FileText,
  FolderSearch2,
  Info,
  LockKeyhole,
  MapPin,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AccessOption, DatasetFamily } from '../types/catalog'

interface ResultCardProps {
  result: DatasetFamily
  displayRank: number
}

const accessIcons = {
  report: FileBarChart,
  download: Download,
  api: Code2,
  request: LockKeyhole,
}

function AccessItem({ option }: { option: AccessOption }) {
  const Icon = accessIcons[option.kind]
  const content = (
    <>
      <Icon aria-hidden="true" />
      <span><strong>{option.label}</strong><small>{option.description}</small></span>
    </>
  )
  if (option.href) {
    return <a className="access-option" href={option.href} target="_blank" rel="noreferrer">{content}</a>
  }
  return <div className="access-option access-option--pending" title="Source link pending verification">{content}</div>
}

export function ResultCard({ result, displayRank }: ResultCardProps) {
  const verifiedOn = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(result.verification.metadataObservedAt))
  const verifiedSource = result.verification.evidence
    .filter((item) => item.state === 'verified_first_party')
    .flatMap((item) => item.sources)
    .find((source) => source.kind === 'first_party_page')
  const metadataLeft = [
    { label: 'Record type', value: result.recordType, Icon: FolderSearch2 },
    { label: 'Geographic applicability', value: result.geographicApplicability, Icon: MapPin },
    { label: 'Reporting unit', value: result.reportingUnit, Icon: Building2 },
  ]
  const metadataRight = [
    { label: 'Population/facility scope', value: result.populationFacilityScope, Icon: BriefcaseMedical },
    { label: 'Available years', value: result.availableYears, Icon: CalendarDays },
    { label: 'Data through', value: result.verification.dataThrough ?? 'See coverage period', Icon: BarChart3 },
    { label: 'Variables documented', value: result.variableDetails.variableCount === null ? result.variableDetails.status : `${result.variableDetails.variableCount} fields`, Icon: FileText },
  ]

  return (
    <article className="result-card" data-result-id={result.id}>
      <div className="result-card__status">
        <span className="result-card__rank">{displayRank}</span>
        <strong>{result.familyStatus}</strong>
        <div className="result-card__status-rule" />
        <p><b>{result.relevance === 'Browse' ? 'Mode' : 'Relevance'}:</b> {result.relevance}</p>
        <p><b>Relationship:</b> {result.relationship}</p>
        <p className={result.verification.liveVerified ? 'verification-state verification-state--current' : 'verification-state'}>
          <ShieldCheck aria-hidden="true" />
          <span>
            <b>{result.verification.liveVerified ? 'Live verified' : 'Verification pending'}</b>
            <time dateTime={result.verification.metadataObservedAt}>{verifiedOn}</time>
            {verifiedSource && (
              <a href={verifiedSource.locator} target="_blank" rel="noreferrer">
                Evidence source <ExternalLink aria-hidden="true" />
              </a>
            )}
          </span>
        </p>
      </div>
      <div className="result-card__main">
        <h2><Link to={result.detailsUrl}>{result.title}</Link></h2>
        <p className="result-card__description">{result.description}</p>
        {result.variableDetails.summary && <p className="result-card__variable-summary"><b>What the fields tell you:</b> {result.variableDetails.summary}</p>}
        <div className="result-card__metadata">
          {[metadataLeft, metadataRight].map((group, groupIndex) => (
            <dl key={groupIndex}>
              {group.map(({ label, value, Icon }) => (
                <div className="metadata-row" key={label}>
                  <Icon aria-hidden="true" />
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      </div>
      <div className="result-card__access">
        <h3>Access and requirements <Info aria-hidden="true" /></h3>
        <div className="result-card__access-list">
          {result.accessOptions.map((option) => <AccessItem key={option.id} option={option} />)}
        </div>
        <Link className="view-details" to={result.detailsUrl}>View details</Link>
      </div>
    </article>
  )
}
