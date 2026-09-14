import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ObservatoryLogo } from './ObservatoryLogo'

interface ObservatoryHeaderProps {
  compact?: boolean
}

export const PRIMARY_NAVIGATION = [
  { to: '/search', label: 'Explore', name: 'Explore catalog sources' },
  { to: '/learn', label: 'Learn', name: 'Learn how USHSO finds sources without obtaining restricted data' },
  { to: '/sources', label: 'Coverage', name: 'Inspect current coverage and known gaps' },
  { to: '/about', label: 'About', name: 'About the Observatory' },
  { to: '/agents', label: 'Developers', name: 'Developer and agent API documentation' },
] as const

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
          {PRIMARY_NAVIGATION.map((item) => (
            <Link key={item.to} to={item.to} aria-label={item.name} onClick={closeMenu}>{item.label}</Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
