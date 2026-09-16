import { Link } from 'react-router-dom'
import { CANDIDATE_ADDITIVE_RECORD_COUNT, CANDIDATE_BASELINE_RECORD_COUNT, CANDIDATE_CORPUS_VERSION, CANDIDATE_ENTRIES, CANDIDATE_GENERATION, CANDIDATE_PARENT_GENERATION, CANDIDATE_RECORD_COUNT, CATALOG_RECORD_COUNT, DISCOVERY_API_PATH, IS_CANDIDATE_MODE } from '../data/catalogMode'

export function CandidateCatalogNotice({ compact = false }: { compact?: boolean }) {
  if (!IS_CANDIDATE_MODE) {
    return null
  }
  return (
    <section className="candidate-notice" aria-label="Research preview sources" role="note">
      <p><strong>Research preview: additional documentation-first sources</strong></p>
      <p>This preview adds documentation-first entries to help with workforce and rural closure questions. Finding a source here is not obtaining data.</p>
      <ul>
        {CANDIDATE_ENTRIES.map(function (entry) {
          return (
            <li key={entry.recordId}>
              <Link to={'/datasets/' + encodeURIComponent(entry.routeId)}>{entry.title}</Link>
              <span> What this source is: {entry.whatItIs} Why it helps: {entry.whyItHelps}</span>
            </li>
          )
        })}
      </ul>
      <p>What is documented: publisher pages and access steps are documented. Coverage, grain, and variables are unknown. Unknowns stay unknown.</p>
      <p>What USHSO actually checked: no live request was made and no payload was retrieved. Access steps are documented but not executed.</p>
      <p>Next steps: open the publisher page, identify the exact dated file, and follow publisher terms before citing data.</p>
      {!compact && (
        <details className="technical-details">
          <summary>Technical details: versions, generations, and counts</summary>
          <p>Candidate catalog {CANDIDATE_CORPUS_VERSION} holds {CANDIDATE_RECORD_COUNT} records. Baseline holds {CANDIDATE_BASELINE_RECORD_COUNT} records. Additive entries: {CANDIDATE_ADDITIVE_RECORD_COUNT}.</p>
          <p>Current catalog holds {CATALOG_RECORD_COUNT} records. Search uses {DISCOVERY_API_PATH}.</p>
          <p>Candidate generation {CANDIDATE_GENERATION} builds on parent {CANDIDATE_PARENT_GENERATION} without changing frozen baseline files.</p>
          <p>Catalog membership is not payload access. Frozen cohort and benchmark files are unchanged.</p>
        </details>
      )}
    </section>
  )
}
