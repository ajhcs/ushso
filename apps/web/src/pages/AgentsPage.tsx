import { Code2 } from 'lucide-react'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import responseExample from '../data/generatedAgentsResponseExample.json'
import webMcpContractJson from '../../../../packages/machine-toolkit/public-webmcp-tool.json'

const curlExample = `curl -sS https://ushso.org/api/discover \\
  -H "content-type: application/json" \\
  --data '{"question":"I need hospital financial and utilization data for Pennsylvania","limit":15}'`

const jsonExample = JSON.stringify(responseExample, null, 2)
const webMcpContract = webMcpContractJson as {
  surface: string
  compatibility_surfaces: string[]
  enabled_tool_count: number
  tools: Array<{ name: string; method: string; route: string }>
  disabled_tools: Array<{ name: string }>
}

export function AgentsPage() {
  return (
    <div className="standard-page agents-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="standard-page__main agents-page__main">
        <Code2 className="standard-page__icon" aria-hidden="true" />
        <p className="standard-page__eyebrow">For developers and AI agents</p>
        <h1>Use the same discovery evidence people see.</h1>
        <span className="gold-rule" aria-hidden="true" />
        <p>USHSO is a read-only routing layer. It returns source metadata, coverage, access requirements, limitations, authoritative locations, and documented join routes. It does not host the underlying data or fetch source payloads when a tool is invoked.</p>

        <section className="api-guide" aria-labelledby="webmcp-status">
          <h2 id="webmcp-status">WebMCP status</h2>
          <p>This build registers {webMcpContract.enabled_tool_count} read-only inspection tools through <code>{webMcpContract.surface}</code>. It also supports the transitional <code>{webMcpContract.compatibility_surfaces[0]}</code> location used by earlier Chromium implementations. Native discovery and invocation require a secure browser that implements one of those WebMCP surfaces. Browsers without either register nothing; the same operations remain available through the versioned same-origin JSON routes below.</p>
          <ul>
            {webMcpContract.tools.map(tool => <li key={tool.name}><code>{tool.name}</code></li>)}
          </ul>
          <p><code>{webMcpContract.disabled_tools[0]?.name}</code> remains disabled because the planning gates are not complete.</p>
        </section>

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
            <div><dt><a href="/api/contract">GET /api/contract</a></dt><dd>Published WebMCP and versioned machine-route activation contract.</dd></div>
            <div><dt>POST /api/discover</dt><dd>Question-to-source discovery. A zero-result response is not evidence that no source exists. <code>returned_count</code>, <code>total_matches</code>, and <code>has_more</code> describe the bounded response; they do not claim a complete catalog.</dd></div>
            <div><dt><a href="/api/catalog">GET /api/catalog</a></dt><dd>Browse the published catalog without inventing a question.</dd></div>
            <div><dt>GET /api/datasets/{'{record_id}'}</dt><dd>Dereference one published record independently of search results.</dd></div>
            <div><dt><a href="/api/health">GET or HEAD /api/health</a></dt><dd>Bounded service and corpus readiness check.</dd></div>
          </dl>
        </section>

        <section className="api-guide" aria-labelledby="machine-routes">
          <h2 id="machine-routes">Versioned machine inspection routes</h2>
          <dl>
            {webMcpContract.tools.map(tool => (
              <div key={tool.name}>
                <dt><code>{tool.method} {tool.route}</code></dt>
                <dd>JSON transport for <code>{tool.name}</code>.</dd>
              </div>
            ))}
          </dl>
          <p>Responses preserve unknown and partial states. Catalog verification means a publisher's first-party catalog metadata was observed live for the pinned snapshot; it does not certify payload availability, schema completeness, authorization, geographic coverage, or analytic fitness.</p>
        </section>

        <div className="status-note" role="note">
          API responses allow cross-origin reads with <code>Access-Control-Allow-Origin: *</code>; <code>OPTIONS</code> preflight is supported. Source-specific accounts, applications, agreements, fees, and restrictions still apply after discovery.
        </div>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
