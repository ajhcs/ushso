import { Link } from 'react-router-dom'
import { LiveCatalogPositioning } from '../components/LiveCatalogPositioning'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { liveCatalogPositioning } from '../data/liveCatalogPositioning'

export function SourcesPage() {
  return (
    <div className="sources-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="sources-page__main">
        <header className="sources-page__heading">
          <p>Published source inventory</p>
          <h1>What USHSO can route you to</h1>
          <p>The catalog describes authoritative sources and their access routes. “Published” means the metadata passed the integration gate; it does not mean USHSO hosts the data or that every endpoint is currently accessible.</p>
          <Link className="button-link" to="/search">Browse all records</Link>
        </header>

        <LiveCatalogPositioning />

        <section className="source-inventory" aria-labelledby="source-inventory-heading">
          <h2 id="source-inventory-heading">Enumerated source catalogs</h2>
          <div className="source-inventory__grid">
            {liveCatalogPositioning.sources.map(source => (
              <article className="source-group" key={source.id}>
                <p>First-party metadata catalog</p>
                <h3>{source.name}</h3>
                <span>{source.recordCount.toLocaleString()} source-native records</span>
                <p><a href={source.catalogUrl}>Open the publisher's catalog endpoint</a></p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <ObservatoryFooter results />
    </div>
  )
}
