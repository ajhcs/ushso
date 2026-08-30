import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'

interface StandardPageProps {
  title: string
  copy: string
}

export function StandardPage({ title, copy }: StandardPageProps) {
  return (
    <div className="standard-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="standard-page__main">
        <h1>{title}</h1>
        <span className="gold-rule" aria-hidden="true" />
        <p>{copy}</p>
        <Link className="button-link" to="/search">Explore data</Link>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
