import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ObservatoryLogo } from './ObservatoryLogo'

interface ObservatoryHeaderProps {
  compact?: boolean
}

export function ObservatoryHeader({ compact = false }: ObservatoryHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  return (
    <header className={`site-header${compact ? ' site-header--compact' : ''}`}>
      <div className="site-header__inner">
        <ObservatoryLogo compact={compact} />
        <button
          className="mobile-menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <nav id="primary-navigation" className={menuOpen ? 'primary-nav primary-nav--open' : 'primary-nav'} aria-label="Primary navigation">
          <Link to="/search" onClick={closeMenu}>Explore Data</Link>
          <Link to="/sources" onClick={closeMenu}>Data Sources</Link>
          <Link to="/#how-it-works" onClick={closeMenu}>How it Works</Link>
        </nav>
      </div>
    </header>
  )
}
