import { Database, ExternalLink, FileText, LockKeyhole, MapPin } from 'lucide-react'

const dimensions = [
  { label: 'What data exists', Icon: Database },
  { label: 'Where it lives', Icon: MapPin },
  { label: 'What it contains', Icon: FileText },
  { label: 'How accessible it is', Icon: LockKeyhole },
  { label: 'How to get it', Icon: ExternalLink },
]

export function DiscoveryDimensions() {
  return (
    <div className="discovery-dimensions" aria-label="What the Observatory helps you understand">
      {dimensions.map(({ label, Icon }) => (
        <div className="discovery-dimension" key={label}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}
