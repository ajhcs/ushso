import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import { OPERATOR, PROPOSED_CORRECTION_POLICY, PUBLIC_CONTACT, SHORTLIST_KEY, UNSUPPLIED } from '../content/learn/accountability'

export function ContactPage() {
  return (
    <div className="information-page">
      <PageTitle label="Contact and corrections" />
      <ObservatoryHeader compact />
      <main id="main-content" className="information-page__main information-page__main--narrow">
        <header className="information-page__heading">
          <p>Contact and corrections</p>
          <h1>Report a catalog issue</h1>
          <p>Email {PUBLIC_CONTACT} for source corrections, access observations, and product feedback. USHSO is operated by {OPERATOR}. {PUBLIC_CONTACT} is the verified public contact. Private forwarding addresses are not published.</p>
        </header>
        <section aria-labelledby="contact-public-heading">
          <h2 id="contact-public-heading">Public issue route</h2>
          <a className="button-link" href="https://github.com/ajhcs/ushso/issues/new?title=USHSO%20catalog%20feedback" target="_blank" rel="noreferrer">Open a GitHub issue</a>
          <p>Dataset detail pages provide a correction link prefilled with the record ID, catalog generation, page URL, and an empty affected-field prompt. The originating research question is intentionally excluded. Protected health information is not attached automatically.</p>
        </section>
        <section aria-labelledby="contact-private-heading">
          <h2 id="contact-private-heading">Private contact</h2>
          <p><a className="button-link" href={`mailto:${PUBLIC_CONTACT}`}>Email {PUBLIC_CONTACT}</a></p>
          <p>Include the record ID, affected field, and a supporting publisher link. Do not send protected health information, credentials, or restricted datasets. {UNSUPPLIED.response_time}</p>
        </section>
        <section aria-labelledby="contact-policy-heading">
          <h2 id="contact-policy-heading">Proposed correction response policy</h2>
          <p>This text is proposed for owner review. It is not an adopted acknowledgement-time promise. Status: {PROPOSED_CORRECTION_POLICY.status.replaceAll('_', ' ')}.</p>
          <ul>
            {PROPOSED_CORRECTION_POLICY.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
          <p>Named correction authority: not supplied. Private forwarding addresses: not published.</p>
        </section>
        <section aria-labelledby="contact-storage-heading">
          <h2 id="contact-storage-heading">Local shortlist and source rights</h2>
          <p>The browser shortlist is stored locally under <code>{SHORTLIST_KEY}</code>. Private notes stay in this browser unless you explicitly export them. Shortlist success is not scientific suitability.</p>
          <p>Source-specific licenses, fees, applications, data-use agreements, and restrictions continue to apply at the publisher. USHSO citations name the publisher product; USHSO verification is separate and is not a publisher endorsement.</p>
          <p><Link to="/workspace">Open the local shortlist</Link> or <Link to="/privacy">read the privacy notice</Link>.</p>
        </section>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
