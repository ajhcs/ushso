import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'

const disclosures = [
  ['Operator', 'The American Journal of Healthcare Strategy operates USHSO.'],
  ['Editorial responsibility', 'The site owner retains final approval of publication and research guidance. Automated checks and model-assisted reviews inform that decision; they do not replace it.'],
  ['Institutional affiliations', 'Not disclosed. The Observatory name does not imply affiliation with or endorsement by the United States government, a university, or any source publisher.'],
  ['Funding and conflicts', 'Funding sources, financial interests, and conflict-of-interest declarations have not been supplied for publication.'],
] as const

export function AboutPage() {
  return (
    <div className="information-page">
      <PageTitle label="About the Observatory" />
      <ObservatoryHeader compact />
      <main id="main-content" className="information-page__main">
        <header className="information-page__heading">
          <p>About the Observatory</p>
          <h1>An evidence-bound discovery and routing layer</h1>
          <p>USHSO helps researchers inspect published metadata and reach authoritative health-systems data sources. It does not host the underlying datasets, and a catalog result is not a judgment that a source is fit for a particular analysis.</p>
        </header>

        <section aria-labelledby="about-scope-heading">
          <h2 id="about-scope-heading">Current scope</h2>
          <p>The product indexes a bounded, versioned catalog. It preserves source locators, evidence, access conditions, unresolved facts, and typed failure states. It does not perform live source discovery during a search, and an empty result never establishes that no relevant source exists.</p>
          <p><Link to="/sources">Inspect catalog coverage and known gaps</Link> or <Link to="/methods">read the inclusion and evaluation methods</Link>.</p>
        </section>

        <section aria-labelledby="about-governance-heading">
          <h2 id="about-governance-heading">Governance and disclosures</h2>
          <p className="disclosure-intro">Our operator and approval responsibilities are stated below. Disclosures not yet supplied remain explicit.</p>
          <dl className="disclosure-list">
            {disclosures.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>

        <section aria-labelledby="about-corrections-heading">
          <h2 id="about-corrections-heading">Corrections and accountability</h2>
          <p>Metadata corrections can be proposed in the public issue tracker and should identify the affected record and field. Do not post protected health information, credentials, embargoed material, or sensitive security details in a public issue.</p>
          <a className="button-link" href="https://github.com/ajhcs/ushso/issues/new?title=USHSO%20metadata%20correction" target="_blank" rel="noreferrer">Open a metadata-correction issue</a>
          <p>For private corrections, email info@ushso.org. Do not send protected health information or credentials.</p>
        </section>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
