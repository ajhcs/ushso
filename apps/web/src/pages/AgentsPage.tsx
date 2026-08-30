import { Code2 } from 'lucide-react'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'

export function AgentsPage() {
  return (
    <div className="standard-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="standard-page__main">
        <Code2 className="standard-page__icon" aria-hidden="true" />
        <p className="standard-page__eyebrow">For AI agents</p>
        <h1>One discovery model for people and machines.</h1>
        <span className="gold-rule" aria-hidden="true" />
        <p>The Observatory is being designed so agents can discover healthcare data using the same source metadata available to people: what a source contains, its coverage, access requirements, limitations, and authoritative location.</p>
        <p>The read-only JSON API and WebMCP adapter use the same canonical discovery-result contract as this site. Neither interface performs live web discovery or generates source claims.</p>
        <div className="status-note" role="note">
          API: <code>POST /api/discover</code>. The <code>observatory.discover_sources</code> WebMCP tool registers when the browser provides <code>document.modelContext</code>.
        </div>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
