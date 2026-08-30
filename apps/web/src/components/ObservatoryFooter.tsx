import { Link } from 'react-router-dom'
import { ObservatoryLogo } from './ObservatoryLogo'

interface ObservatoryFooterProps {
  results?: boolean
}

export function ObservatoryFooter({ results = false }: ObservatoryFooterProps) {
  const year = new Date().getFullYear()
  return (
    <footer className={`site-footer${results ? ' site-footer--results' : ''}`}>
      {results && (
        <div className="site-footer__callout">
          <h2>Find the right health data—and understand how to access it.</h2>
          <span aria-hidden="true" />
        </div>
      )}
      <div className="site-footer__bottom">
        <div className="site-footer__mission">
          <ObservatoryLogo footer />
          <p>A public gateway to discover, understand, and access<br />the nation’s health systems data.</p>
        </div>
        <div className="site-footer__copyright">
          <span>© {year} United States Health Systems Observatory</span>
          <nav className="site-footer__links" aria-label="Footer navigation">
            <Link to="/about">About</Link>
            <Link to="/sources">Sources</Link>
            <Link to="/agents">Agents & API</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/contact">Contact</Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
