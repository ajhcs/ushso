import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { DiscoveryDimensions } from '../components/DiscoveryDimensions'
import { HowItWorks } from '../components/HowItWorks'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { SearchBox } from '../components/SearchBox'
import { PageTitle } from '../components/PageTitle'

export const CURRENT_GENERATION = 'live-2026-09-03-85b50522b420'
export const CURRENT_CORPUS_RECORD_COUNT = 3434

const journeys = [
  {
    id: 'finance-utilization',
    question: 'Hospital cost-report net patient revenue for Pennsylvania',
    source: 'CMS Hospital Provider Cost Report (HCRIS)',
    access: 'Public CMS catalog documentation. Finding this source is not payload access.',
    href: '/search?q=CMS%20HCRIS%20hospital%20cost%20reports',
  },
  {
    id: 'insurance-geography',
    question: 'County uninsured estimates without inventing Census coverage',
    source: 'CDC PLACES county estimates',
    access: 'Documented county metadata. An explicit without-Census filter excludes Census sources.',
    href: '/search?q=CDC%20PLACES%20county%20uninsured',
  },
  {
    id: 'public-health',
    question: 'Find HCUP inpatient stays',
    source: 'AHRQ HCUP',
    access: 'Restricted application route. Finding the source is not obtaining the research file.',
    href: '/learn#restricted-data',
  },
] as const

export function LandingPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const search = (query: string) => {
    const next = new URLSearchParams({ q: query })
    navigate(`/search?${next.toString()}`)
  }

  return (
    <div className="landing-page">
      <PageTitle label="Health data source discovery" />
      <ObservatoryHeader />
      <main id="main-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero__inner">
            <h1 id="landing-title">Find the health-systems data<br />{' '}that answers your question.</h1>
            <span className="gold-rule" aria-hidden="true" />
            <p>USHSO is a discovery and routing layer. It shows what sources exist, the evidence behind each preview, and the documented access route. It does not host the underlying datasets or fetch restricted files for you.</p>
            <SearchBox initialQuery={params.get('q') ?? ''} onSubmit={search} />
            <DiscoveryDimensions />
            <p className="landing-scope">Current catalog generation <code>{CURRENT_GENERATION}</code> contains {CURRENT_CORPUS_RECORD_COUNT} indexed source identities. Catalog membership is not payload access.</p>
            <p><Link to="/learn">Learn how finding a source differs from obtaining restricted data</Link></p>
            <p><Link to="/learn#first-search">Start the beginner sequence with a verified HCRIS search</Link></p>
          </div>
        </section>
        <section className="learning-journeys" aria-labelledby="journeys-title">
          <div className="learning-journeys__inner">
            <h2 id="journeys-title">Three tested example journeys</h2>
            <p>These questions come from accepted example packets on generation {CURRENT_GENERATION}. They are metadata routes, not completed research tasks.</p>
            <ul>
              {journeys.map((journey) => (
                <li key={journey.id}>
                  <article>
                    <h3>{journey.question}</h3>
                    <p><strong>Verified source example:</strong> {journey.source}</p>
                    <p>{journey.access}</p>
                    <Link to={journey.href}>Open this journey</Link>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <HowItWorks />
      </main>
      <ObservatoryFooter />
    </div>
  )
}
