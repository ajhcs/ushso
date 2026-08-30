import { Code2 } from 'lucide-react'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import agentsExampleSource from '../data/agents-discovery-example.json'
import { agentsCurlExample } from '../data/agentsDiscoveryExample'

const curlExample = agentsCurlExample(agentsExampleSource.question, agentsExampleSource.limit)
const jsonExample = JSON.stringify(agentsExampleSource.example, null, 2)

export function AgentsPage() {
  return (
    <div className="standard-page agents-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="standard-page__main agents-page__main">
        <Code2 className="standard-page__icon" aria-hidden="true" />
        <p className="standard-page__eyebrow">For developers and AI agents</p>
        <h1>Use the same discovery evidence people see.</h1>
        <span className="gold-rule" aria-hidden="true" />
        <p>USHSO is a read-only routing layer. It returns source metadata, coverage, access requirements, limitations, authoritative locations, and documented join routes. It does not host the underlying data or perform live web discovery.</p>

        <section className="api-guide" aria-labelledby="api-quick-start">
          <h2 id="api-quick-start">Quick start</h2>
          <p>Send a JSON question to the discovery endpoint. Requests are limited to 20 KiB. The response excerpt below is generated from the accepted published fixture, not a hand-maintained sketch.</p>
          <pre><code>{curlExample}</code></pre>
          <h3>Response shape</h3>
          <pre><code>{jsonExample}</code></pre>
        </section>

        <section className="api-guide" aria-labelledby="api-routes">
          <h2 id="api-routes">Routes and behavior</h2>
          <dl>
            <div><dt><a href="/api/contract">GET /api/contract</a></dt><dd>Canonical machine-readable request and result contract.</dd></div>
            <div><dt>POST /api/discover</dt><dd>Question-to-source discovery. A zero-result response is not evidence that no source exists. <code>returned_count</code>, <code>total_matches</code>, and <code>has_more</code> describe the bounded response; they do not claim a complete catalog.</dd></div>
            <div><dt><a href="/api/catalog">GET /api/catalog</a></dt><dd>Browse the published catalog without inventing a question.</dd></div>
            <div><dt>GET /api/datasets/{'{record_id}'}</dt><dd>Dereference one published record independently of search results.</dd></div>
            <div><dt><a href="/api/health">GET or HEAD /api/health</a></dt><dd>Bounded service and corpus readiness check.</dd></div>
          </dl>
        </section>

        <div className="status-note" role="note">
          API responses allow cross-origin reads with <code>Access-Control-Allow-Origin: *</code>; <code>OPTIONS</code> preflight is supported. Source-specific accounts, applications, agreements, fees, and restrictions still apply after discovery.
        </div>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
