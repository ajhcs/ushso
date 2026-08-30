import { useNavigate, useSearchParams } from 'react-router-dom'
import { DiscoveryDimensions } from '../components/DiscoveryDimensions'
import { HowItWorks } from '../components/HowItWorks'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { SearchBox } from '../components/SearchBox'

export function LandingPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const search = (query: string) => {
    const next = new URLSearchParams({ q: query })
    navigate(`/search?${next.toString()}`)
  }

  return (
    <div className="landing-page">
      <ObservatoryHeader />
      <main id="main-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero__inner">
            <h1 id="landing-title">Find the public health data<br />{' '}that answers your question.</h1>
            <span className="gold-rule" aria-hidden="true" />
            <p>Discover what data exists, where it lives, what it contains,<br />and how to access it.</p>
            <SearchBox initialQuery={params.get('q') ?? ''} onSubmit={search} />
            <DiscoveryDimensions />
          </div>
        </section>
        <HowItWorks />
      </main>
      <ObservatoryFooter />
    </div>
  )
}
