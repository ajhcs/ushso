import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'

export function ContactPage() {
  return (
    <div className="information-page">
      <PageTitle label="Contact and corrections" />
      <ObservatoryHeader compact />
      <main id="main-content" className="information-page__main information-page__main--narrow">
        <header className="information-page__heading">
          <p>Contact and corrections</p>
          <h1>Report a catalog issue</h1>
          <p>Use the public repository’s issue form for source corrections, access observations, and product feedback.</p>
        </header>
        <section aria-labelledby="contact-public-heading">
          <h2 id="contact-public-heading">Public issue route</h2>
          <a className="button-link" href="https://github.com/ajhcs/ushso/issues/new?title=USHSO%20catalog%20feedback" target="_blank" rel="noreferrer">Open a GitHub issue</a>
          <p>Dataset detail pages provide a correction link prefilled with the record ID, catalog generation, page URL, and an empty affected-field prompt. The research question is intentionally excluded.</p>
        </section>
        <section aria-labelledby="contact-private-heading">
          <h2 id="contact-private-heading">Private contact</h2>
          <p><strong>Status: not yet published.</strong> The owner has not supplied a verified private email address or form for this release. Do not put protected health information, credentials, embargoed material, or sensitive security details in a public issue.</p>
        </section>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
