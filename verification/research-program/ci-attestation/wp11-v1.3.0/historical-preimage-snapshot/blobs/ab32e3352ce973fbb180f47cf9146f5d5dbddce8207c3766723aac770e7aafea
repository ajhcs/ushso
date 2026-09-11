import { Link } from 'react-router-dom'

interface ObservatoryLogoProps {
  compact?: boolean
  footer?: boolean
}

export function ObservatoryLogo({ compact = false, footer = false }: ObservatoryLogoProps) {
  return (
    <Link
      className={`observatory-logo${compact ? ' observatory-logo--compact' : ''}${footer ? ' observatory-logo--footer' : ''}`}
      to="/"
      aria-label="United States Health Systems Observatory home"
    >
      <img src="/observatory-lighthouse.png" alt="" />
      {!footer && (
        <span>
          United States
          <br />
          Health Systems Observatory
        </span>
      )}
    </Link>
  )
}
