import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import {
  CMS_LANDING,
  LEARN_GENERATION,
  allGuides,
  beginnerGuides,
} from '../content/learn/guides'

export const CURRENT_GENERATION = LEARN_GENERATION

const destinations = [
  { question: 'Where do I browse sources?', href: '/search', label: 'Explore', example: 'Search CMS HCRIS hospital cost-report metadata.' },
  { question: 'What is currently indexed?', href: '/sources', label: 'Coverage', example: 'Inspect generation ' + CURRENT_GENERATION + ' coverage and known gaps.' },
  { question: 'Who operates this and what is in scope?', href: '/about', label: 'About', example: 'Read operator, scope, and disclosure statements.' },
  { question: 'How do agents call the same evidence?', href: '/agents', label: 'Developers', example: 'Use the eight read-only inspection tools. plan_research stays disabled.' },
] as const

function GuideSection({ id, title, nextHref, nextLabel, paragraphs, terms, steps, examples }: (typeof allGuides)[number]) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {terms && (
        <dl className="learn-terms">
          {terms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>)}
        </dl>
      )}
      {steps && (
        <ol className="learn-steps">
          {steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      {id === 'first-search' && <p><Link to="/search?q=CMS%20HCRIS%20hospital%20cost%20reports">Open the verified HCRIS search</Link></p>}
      {id === 'read-source' && <p><a href={CMS_LANDING} target="_blank" rel="noreferrer">Open the CMS documentation page</a>. This is a reachable documentation page, not proven payload access.</p>}
      {examples?.map((example) => (
        <figure key={example.label} className="learn-example">
          <figcaption>{example.label}</figcaption>
          <pre><code>{example.code}</code></pre>
          <p className="learn-example__status">{example.status}</p>
        </figure>
      ))}
      <p><Link to={nextHref}>{nextLabel}</Link></p>
    </section>
  )
}

export function LearnPage() {
  return (
    <div className="information-page">
      <PageTitle label="Learn how to use USHSO" />
      <ObservatoryHeader compact />
      <main id="main-content" className="information-page__main">
        <header className="information-page__heading">
          <p>Learn</p>
          <h1>Finding a source is not obtaining the data.</h1>
          <p>USHSO helps you inspect published metadata and documented access routes. A successful page load, search result, or tool envelope is not a completed research task. Restricted files still require the publisher’s process. These guides are versioned to generation {CURRENT_GENERATION}.</p>
        </header>

        <section aria-labelledby="learn-destinations-heading">
          <h2 id="learn-destinations-heading">Choose a starting route</h2>
          <ul className="learn-destinations">
            {destinations.map((item) => (
              <li key={item.href}>
                <p>{item.question}</p>
                <Link to={item.href}>{item.label}</Link>
                <p>{item.example}</p>
              </li>
            ))}
          </ul>
        </section>

        <nav className="learn-sequence" aria-label="Beginner sequence">
          {beginnerGuides.map((guide) => <Link key={guide.id} to={`/learn#${guide.id}`}>{guide.title}</Link>)}
          <Link to="/learn#access-routes">Access routes</Link>
          <Link to="/learn#developer-quick-start">Developer and MCP quick start</Link>
        </nav>

        {allGuides.map((guide) => <GuideSection key={guide.id} {...guide} />)}

        <section id="restricted-data" aria-labelledby="learn-restricted-heading">
          <h2 id="learn-restricted-heading">Public, keyed, and restricted access</h2>
          <p>Public CMS catalog pages can be opened without a USHSO login. Census metadata may name an API key that you hold. HCUP research files remain a restricted application route. USHSO does not collect eligibility or credentials, and it does not retrieve those files.</p>
        </section>

        <section aria-labelledby="learn-disabled-heading">
          <h2 id="learn-disabled-heading">Disabled features stay off the primary path</h2>
          <p>Research-plan compilation is not available yet. The planner is not a primary action from this navigation. Do not treat a disabled <code>plan_research</code> capability as an enabled product.</p>
          <p><Link to="/learn">Stay on the learning material</Link> or <Link to="/search">explore catalog sources</Link>.</p>
        </section>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
