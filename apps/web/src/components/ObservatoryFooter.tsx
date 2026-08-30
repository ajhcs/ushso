import { Code2, Globe2 } from 'lucide-react'
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
          <nav aria-label="Footer navigation">
            <Link to="/about">About</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/contact">Contact</Link>
          </nav>
        </div>
      )}
      <div className="site-footer__bottom">
        <div className="site-footer__mission">
          <ObservatoryLogo footer />
          <p>A public gateway to discover, understand, and access<br />the nation’s health systems data.</p>
        </div>
        <div className="site-footer__copyright">
          <span>© {year} United States Health Systems Observatory</span>
          {results && (
            <div className="site-footer__icons">
              <Link to="/sources" aria-label="Browse data sources"><Globe2 aria-hidden="true" /></Link>
              <Link to="/agents" aria-label="Machine-readable interfaces for AI agents"><Code2 aria-hidden="true" /></Link>
            </div>
          )}
        </div>
      </div>
    </footer>
  )
}
