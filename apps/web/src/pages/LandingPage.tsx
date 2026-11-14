import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import publicRegression from '../../../../evaluation/source-selection/queries.public.json'
import { DiscoveryDimensions } from '../components/DiscoveryDimensions'
import { HowItWorks } from '../components/HowItWorks'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { SearchBox } from '../components/SearchBox'
import { PageTitle } from '../components/PageTitle'

const exampleIds = new Set(['pa-finance', 'county-life', 'medicaid'])
const taskExamples = publicRegression.queries.filter(query => exampleIds.has(query.query_id))

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
            <h1 id="landing-title">Find and assess<br />{' '}health-systems data sources.</h1>
            <span className="gold-rule" aria-hidden="true" />
            <p>Discover what data exists, where it lives, what it contains,<br />{' '}and how to access it.</p>
            <SearchBox initialQuery={params.get('q') ?? ''} onSubmit={search} />
            <section aria-labelledby="task-examples-heading">
              <h2 id="task-examples-heading">Example questions to explore</h2>
              <ul>{taskExamples.map(example => <li key={example.query_id}><Link to={`/search?${new URLSearchParams({ q: example.text }).toString()}`}>{example.text}</Link></li>)}</ul>
              <p>Use these questions as starting points. Check each source’s coverage, access requirements and limitations before choosing it.</p>
            </section>
            <DiscoveryDimensions />
          </div>
        </section>
        <HowItWorks />
      </main>
      <ObservatoryFooter />
    </div>
  )
}
