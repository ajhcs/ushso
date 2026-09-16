import { Link } from 'react-router-dom'
import { ACTIVE_CATALOG } from '../data/catalogDescriptor'
import { CANDIDATE_ADDITIVE_RECORD_COUNT, CANDIDATE_BASELINE_RECORD_COUNT, CANDIDATE_CORPUS_VERSION, CANDIDATE_ENTRIES, CANDIDATE_GENERATION, CANDIDATE_PARENT_GENERATION, CANDIDATE_RECORD_COUNT } from '../data/candidateCatalog'

export function CandidateCatalogNotice({ compact = false }: { compact?: boolean }) {
  if (!ACTIVE_CATALOG.isCandidate) return null

  return (
    <section className="candidate-notice" aria-label="Candidate catalog version" role="note">
      <p><strong>Candidate catalog {CANDIDATE_CORPUS_VERSION}</strong> (explicitly versioned, additive).</p>
      {!compact && <p>Search on this page runs against candidate generation <code>{CANDIDATE_GENERATION}</code>: {CANDIDATE_RECORD_COUNT.toLocaleString()} records = {CANDIDATE_BASELINE_RECORD_COUNT.toLocaleString()} frozen baseline records (generation {CANDIDATE_PARENT_GENERATION}, unchanged) + {CANDIDATE_ADDITIVE_RECORD_COUNT} documentation-first entries.</p>}
      <ul>
        {CANDIDATE_ENTRIES.map((entry) => (
          <li key={entry.recordId}><Link to={`/datasets/${encodeURIComponent(entry.routeId)}`}>{entry.title}</Link> · access unknown · not live-verified · variables unknown · access steps documented-not-executed (<a href={entry.packetUrl} download={entry.packetFilename}>evidence packet</a>)</li>
        ))}
      </ul>
      {!compact && <p>Catalog membership is not payload access. Baseline corpus v1.2.0 stays published at the versioned baseline API; frozen cohort and benchmark files are unchanged.</p>}
    </section>
  )
}
