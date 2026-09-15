import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import { PUBLIC_CONTACT, SHORTLIST_KEY, UNSUPPLIED } from '../content/learn/accountability'

interface StandardPageProps {
  title: string
  copy: string
}

export function StandardPage({ title, copy }: StandardPageProps) {
  const privacy = title === 'Privacy'
  const terms = title === 'Terms'
  return (
    <div className="standard-page">
      <PageTitle label={title} />
      <ObservatoryHeader compact />
      <main id="main-content" className="standard-page__main">
        <h1>{title}</h1>
        <span className="gold-rule" aria-hidden="true" />
        <p>{copy}</p>
        {privacy && (
          <>
            <p>The local shortlist uses browser storage key <code>{SHORTLIST_KEY}</code>. Private notes do not leave the browser unless you explicitly export them. Correction mail to {PUBLIC_CONTACT} is composed by you; the product does not automatically attach the originating research question or protected health information.</p>
            <p>{UNSUPPLIED.response_time} No account is required.</p>
          </>
        )}
        {terms && (
          <p>Source-specific rights remain with the publisher. Catalog membership is not payload access, authorization, schema completeness, or scientific approval. A successful page load or tool envelope is not a completed research task.</p>
        )}
        <Link className="button-link" to="/search">Explore data</Link>
        <p><Link to="/contact">Contact and corrections</Link></p>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
