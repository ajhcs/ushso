import { CalendarClock, CheckCircle2, ShieldCheck } from 'lucide-react'
import { liveCatalogPositioning } from '../data/liveCatalogPositioning'

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(date)
}

export function LiveCatalogPositioning() {
  const catalog = liveCatalogPositioning
  return (
    <section
      className="coverage-positioning"
      aria-labelledby="live-catalog-positioning-heading"
      data-catalog-generation={catalog.generation}
    >
      <div className="coverage-positioning__review" role="status">
        <CheckCircle2 aria-hidden="true" />
        <span>All {catalog.recordCount.toLocaleString()} published records were present in live first-party catalog metadata at this snapshot.</span>
      </div>
      <header>
        <p>Live catalog accounting · corpus v{catalog.corpusVersion}</p>
        <h2 id="live-catalog-positioning-heading">{catalog.recordCount.toLocaleString()} source-native records from {catalog.sourceCount} enumerated federal catalogs</h2>
        <p>USHSO made {catalog.metadataRequests} bounded metadata requests and downloaded {catalog.payloadDownloads} dataset payloads. Every source-native record was preserved separately; no records were merged by title or similarity.</p>
      </header>
      <div className="coverage-positioning__concepts">
        {catalog.sources.map(source => (
          <article key={source.id}>
            <strong>{source.recordCount.toLocaleString()}</strong>
            <h3>{source.name}</h3>
            <p>First-party catalog entries observed in the complete enumerated response.</p>
          </article>
        ))}
      </div>
      <div className="coverage-positioning__boundaries">
        <p><ShieldCheck aria-hidden="true" /> <strong>What “current — metadata observed live” means:</strong> the record appeared in its publisher's live catalog enumeration, and the enumeration response is hash-receipted.</p>
        <p><strong>What it does not mean:</strong> USHSO did not download each dataset, test every distribution or variable, establish geographic coverage, bypass authorization, or certify fitness for analysis. Those claims remain unknown unless separately evidenced.</p>
        <p>A zero search result is still scoped to this three-catalog snapshot; it is never proof that no relevant public source exists.</p>
      </div>
      <aside className="coverage-accounting-note" aria-label="Live catalog snapshot">
        <CalendarClock aria-hidden="true" />
        <div>
          <p><strong>Generation:</strong> {catalog.generation}</p>
          <p><strong>Observed:</strong> <time dateTime={catalog.observedAt}>{formatDate(catalog.observedAt)}</time></p>
        </div>
      </aside>
    </section>
  )
}
