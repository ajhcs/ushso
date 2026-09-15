import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import { OPERATOR, PUBLIC_CONTACT, RESEARCH_EXAMPLES, UNSUPPLIED } from '../content/learn/accountability'

const disclosures = [
  ['Operator', `${OPERATOR} operates USHSO.`],
  ['Editorial responsibility', 'The site owner retains final approval of publication and research guidance. Automated checks and model-assisted reviews inform that decision; they do not replace it.'],
  ['Institutional affiliations', UNSUPPLIED.affiliations],
  ['Funding and conflicts', UNSUPPLIED.funding],
  ['Named editorial roles', UNSUPPLIED.named_editorial_roles],
  ['Staff', UNSUPPLIED.staff],
  ['Current outcomes', UNSUPPLIED.outcomes],
] as const

export function AboutPage() {
  return (
    <div className="information-page">
      <PageTitle label="About the Observatory" />
      <ObservatoryHeader compact />
      <main id="main-content" className="information-page__main">
        <header className="information-page__heading">
          <p>About the Observatory</p>
          <h1>Find published health-systems sources and see how to reach them.</h1>
          <p>USHSO is for researchers, analysts, journalists, and developers who need to inspect published United States health-systems metadata before they request files, keys, or restricted access. It is a discovery and routing layer, not a data warehouse and not a government service.</p>
        </header>

        <section aria-labelledby="about-users-heading">
          <h2 id="about-users-heading">Who it is for</h2>
          <p>If you are trying to answer a health-systems question, start by finding the publisher product, the exact release, the documented grain, and the access route. USHSO keeps those facts visible so you can decide whether a source is worth pursuing at the publisher.</p>
          <p>Intended users include health-services researchers, hospital and payer analysts, public-health practitioners, journalists, and developers building read-only inspection tools. A catalog result is not a judgment that a source is fit for a particular analysis.</p>
        </section>

        <section aria-labelledby="about-examples-heading">
          <h2 id="about-examples-heading">Concrete starting examples</h2>
          <ul className="learn-destinations">
            {RESEARCH_EXAMPLES.map((example) => (
              <li key={example.label}>
                <p><strong>{example.label}</strong></p>
                <p>{example.body}</p>
              </li>
            ))}
          </ul>
          <p><Link to="/learn">Start with the beginner guides</Link> or <Link to="/search?q=CMS%20HCRIS%20hospital%20cost%20reports">search CMS HCRIS hospital cost reports</Link>.</p>
        </section>

        <section aria-labelledby="about-scope-heading">
          <h2 id="about-scope-heading">Current scope</h2>
          <p>The product indexes a bounded, versioned catalog. It preserves source locators, evidence, access conditions, unresolved facts, and typed failure states. It does not perform live source discovery during a search, and an empty result never establishes that no relevant source exists.</p>
          <p>{OPERATOR} operates USHSO independently. The Observatory name does not imply affiliation with or endorsement by the United States government, a university, or any source publisher.</p>
          <p><Link to="/sources">Inspect catalog coverage and known gaps</Link> or <Link to="/methods">read the inclusion and evaluation methods</Link>.</p>
        </section>

        <section aria-labelledby="about-governance-heading">
          <h2 id="about-governance-heading">Governance and disclosures</h2>
          <p className="disclosure-intro">Operator and approval responsibilities are stated below. Disclosures not yet supplied remain explicit. Unsupplied facts are not filled by an engineer, a model, or a guessed service promise.</p>
          <dl className="disclosure-list">
            {disclosures.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>

        <section aria-labelledby="about-corrections-heading">
          <h2 id="about-corrections-heading">Corrections and accountability</h2>
          <p>Metadata corrections can be proposed in the public issue tracker and should identify the affected record and field. Do not post protected health information, credentials, embargoed material, or sensitive security details in a public issue.</p>
          <a className="button-link" href="https://github.com/ajhcs/ushso/issues/new?title=USHSO%20metadata%20correction" target="_blank" rel="noreferrer">Open a metadata-correction issue</a>
          <p>For private corrections, <a href={`mailto:${PUBLIC_CONTACT}`}>email {PUBLIC_CONTACT}</a>. Do not send protected health information or credentials. {UNSUPPLIED.response_time}</p>
          <p><Link to="/contact">See all correction and contact routes</Link>.</p>
        </section>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
