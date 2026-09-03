import { AlertCircle, CalendarClock } from 'lucide-react'
import { coveragePositioning } from '../data/coveragePositioning'

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

export function CoverageAccountingNote({ compact = false }: { compact?: boolean }) {
  return (
    <aside
      className={compact ? 'coverage-accounting-note coverage-accounting-note--compact' : 'coverage-accounting-note'}
      aria-label="Coverage accounting boundary"
      data-coverage-snapshot={coveragePositioning.coverageSnapshotId}
    >
      <CalendarClock aria-hidden="true" />
      <div>
        <p><strong>Coverage snapshot:</strong> {coveragePositioning.coverageSnapshotId}</p>
        <p><strong>As of:</strong> <time dateTime={coveragePositioning.asOf}>{formatDate(coveragePositioning.asOf)}</time></p>
        <p>{coveragePositioning.nonAdditivity}</p>
      </div>
    </aside>
  )
}

export function CoveragePositioning() {
  const { concepts } = coveragePositioning
  return (
    <section
      className="coverage-positioning"
      aria-labelledby="coverage-positioning-heading"
      data-copy-version={coveragePositioning.copyVersion}
      data-owner-review-status={coveragePositioning.ownerReview.status}
    >
      <div className="coverage-positioning__review" role="note">
        <AlertCircle aria-hidden="true" />
        <span>Unpublished coverage wording preview · product-owner approval is pending.</span>
      </div>
      <header>
        <p>Versioned public coverage accounting</p>
        <h2 id="coverage-positioning-heading">{coveragePositioning.headline}</h2>
        <p>{coveragePositioning.federalBackbone}</p>
      </header>
      <div className="coverage-positioning__concepts">
        <article>
          <strong>{concepts.federalSourceScopes.count}</strong>
          <h3>{concepts.federalSourceScopes.unit}</h3>
          <p>{concepts.federalSourceScopes.direct} direct · {concepts.federalSourceScopes.crosswalkRequired} crosswalk-required · {concepts.federalSourceScopes.unknown} unknown applicability.</p>
        </article>
        <article>
          <strong>{concepts.jurisdictions.count}</strong>
          <h3>{concepts.jurisdictions.unit}</h3>
          <p>{concepts.assessmentCells.count} source-class cells; all {concepts.assessmentCells.notAssessed} are honestly not assessed.</p>
        </article>
        <article>
          <strong>{concepts.corpusRecords.count}</strong>
          <h3>{concepts.corpusRecords.unit}</h3>
          <p>Corpus v{concepts.corpusRecords.corpusVersion}; record slices are not a completeness denominator.</p>
        </article>
      </div>
      <div className="coverage-positioning__boundaries">
        <p>{coveragePositioning.jurisdictionBoundary}</p>
        <p>{coveragePositioning.corpusBoundary}</p>
        <p>{coveragePositioning.zeroResultBoundary}</p>
      </div>
      <CoverageAccountingNote />
    </section>
  )
}
