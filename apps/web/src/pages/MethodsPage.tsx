import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import {
  CURRENT_CORPUS_ID,
  CURRENT_CORPUS_VERSION,
  CURRENT_EVAL_CLAIMS,
  CURRENT_EVAL_METHODS,
  CURRENT_EVAL_RESULT,
  CURRENT_RECORD_COUNT,
  EVALUATOR_VERSION,
  FAILING_DOMAINS,
  HISTORICAL_BASELINE_RECORD_COUNT,
  HISTORICAL_EVAL_DOC,
  HISTORICAL_EVAL_REPORT,
  METHODS_GENERATION,
  assessmentGuide,
  evaluationGuide,
  joinMrfGuide,
} from '../content/learn/methods'

function GuideBlock({ id, title, paragraphs, examples }: { id: string; title: string; paragraphs: string[]; examples?: Array<{ label: string; body: string }> }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {examples?.map((example) => (
        <figure key={example.label} className="learn-example">
          <figcaption>{example.label}</figcaption>
          <p className="learn-example__status">{example.body}</p>
        </figure>
      ))}
    </section>
  )
}

export function MethodsPage() {
  return (
    <div className="information-page">
      <PageTitle label="Catalog and evaluation methods" />
      <ObservatoryHeader compact />
      <main id="main-content" className="information-page__main">
        <header className="information-page__heading">
          <p>Methods</p>
          <h1>How records are included, described, and evaluated</h1>
          <p>USHSO separates publisher facts, captured evidence, inferred search aids, and unresolved claims. This page describes the public repository’s documented process and its limits. Beginner starting instructions remain on <Link to="/learn">Learn</Link>.</p>
        </header>

        <section aria-labelledby="methods-inclusion-heading">
          <h2 id="methods-inclusion-heading">Catalog inclusion</h2>
          <p>A record can be published when it has a stable technical identity, a source-native title, preserved provenance, a bounded access description, and validation against the public discovery contract. Inclusion means the metadata passed the catalog publication checks; it does not prove payload availability, authorization, schema compatibility, joinability, scientific quality, or fitness.</p>
          <p>Publisher pages, documentation, distributions, and access workflows remain distinct when the evidence supports that distinction. Similar titles and generated identifiers do not establish a dataset family.</p>
        </section>

        <section aria-labelledby="methods-claims-heading">
          <h2 id="methods-claims-heading">Claims and evidence</h2>
          <p>Each record preserves evidence identifiers and source locators. Source-asserted and captured facts remain distinguishable from inferred search categories. Unknown, unavailable, blocked, incompatible, and unresolved states stay explicit instead of being converted into absence claims.</p>
          <p>Availability documented by a publisher is separate from an endpoint or download successfully tested by USHSO. Observation periods are separate from metadata-check dates and publisher release dates where those facts are available.</p>
        </section>

        <GuideBlock {...assessmentGuide} />
        <GuideBlock {...joinMrfGuide} />

        <section aria-labelledby="methods-evaluation-heading">
          <h2 id="methods-evaluation-heading">Evaluation status</h2>
          <div className="method-boundary" role="note">
            <strong>Historical 143-record metrics are not current-generation performance.</strong>
            <p>The repository contains a historical 60-question baseline for a {HISTORICAL_BASELINE_RECORD_COUNT}-record v1.0.1 corpus. It is useful as a labeled historical fixture, but it must not be read as evidence of the current catalog or retrieval version’s performance. Machine-readable historical report: <code>{HISTORICAL_EVAL_REPORT}</code>.</p>
          </div>
          <p>Current-generation evaluation uses evaluator <code>{EVALUATOR_VERSION}</code> on corpus <code>{CURRENT_CORPUS_ID}</code> version {CURRENT_CORPUS_VERSION}, generation {METHODS_GENERATION}, {CURRENT_RECORD_COUNT} records. Results: <code>{CURRENT_EVAL_RESULT}</code>. Methods and named quantitative claims: <code>{CURRENT_EVAL_METHODS}</code>.</p>
          <dl className="learn-terms">
            {Object.entries(CURRENT_EVAL_CLAIMS).map(([name, claim]) => (
              <div key={name}>
                <dt>{name.replaceAll('_', ' ')}</dt>
                <dd>{claim.value} <span>Receipt: {claim.receipt}</span></dd>
              </div>
            ))}
          </dl>
          <p>R07 remains incomplete. Failing domains have bounded remediation tasks instead of a passing summary:</p>
          <ul>
            {FAILING_DOMAINS.map((row) => <li key={row.domain}>{row.domain}: {row.remediation}</li>)}
          </ul>
          <p>Present-source recall counts hits among sources actually present in this generation. Full-universe recall keeps known absent named sources in the denominator so missing coverage does not vanish. Producer tests are reported separately from independent reviewer labels. Held-out labels were not used in producer scoring.</p>
          <a href="https://github.com/ajhcs/ushso/blob/main/docs/EVALUATION.md" target="_blank" rel="noreferrer">Read the historical evaluation documentation</a>
          <p>Historical document path: <code>{HISTORICAL_EVAL_DOC}</code>.</p>
        </section>

        <GuideBlock {...evaluationGuide} />

        <section aria-labelledby="methods-correction-heading">
          <h2 id="methods-correction-heading">Correction process</h2>
          <p>Use the record-level correction action on a dataset page or the public issue tracker. Include the record ID, catalog generation, affected field, and authoritative supporting link. Do not include a research question or protected health information. A review timetable and named correction authority have not yet been published.</p>
          <p><Link to="/contact">See correction and contact routes</Link>.</p>
        </section>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
