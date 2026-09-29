import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'

export function MethodsPage() {
  return (
    <div className="information-page">
      <PageTitle label="Catalog and evaluation methods" />
      <ObservatoryHeader compact />
      <main id="main-content" className="information-page__main">
        <header className="information-page__heading">
          <p>Methods</p>
          <h1>How records are included, described, and evaluated</h1>
          <p>USHSO separates publisher facts, captured evidence, inferred search aids, and unresolved claims. This page describes the public repository’s documented process and its limits.</p>
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

        <section aria-labelledby="methods-evaluation-heading">
          <h2 id="methods-evaluation-heading">Evaluation status</h2>
          <div className="method-boundary" role="note">
            <strong>No current-generation performance result is published on this page.</strong>
            <p>The repository contains a historical 60-question baseline for a 143-record v1.0.1 corpus. It is useful as a labeled historical fixture, but it must not be read as evidence of the current catalog or retrieval version’s performance.</p>
          </div>
          <p>A future current evaluation should name the exact catalog generation, retrieval/ranking version, fixed questions, reviewer labels, result cutoffs, execution time, and known limitations. Until that release artifact exists, the interface makes no current recall or relevance claim.</p>
          <a href="https://github.com/ajhcs/ushso/blob/main/docs/EVALUATION.md" target="_blank" rel="noreferrer">Read the historical evaluation documentation</a>
        </section>

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
