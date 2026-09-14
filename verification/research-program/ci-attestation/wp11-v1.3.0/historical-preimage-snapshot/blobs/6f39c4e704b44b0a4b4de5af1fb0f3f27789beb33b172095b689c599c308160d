import { ChevronDown, Info, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { FacetSectionConfig } from '../types/catalog'

interface FacetSidebarProps {
  selected: string[]
  onToggle: (filter: string) => void
  onClear: () => void
  sections: FacetSectionConfig[]
  mobile?: boolean
  onClose?: () => void
}

export function FacetSidebar({ selected, onToggle, onClear, sections, mobile = false, onClose }: FacetSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<string[]>([])

  const renderOptions = (section: FacetSectionConfig) => {
    const expanded = expandedSections.includes(section.id)
    const options = section.expandable && !expanded ? section.options.slice(0, 5) : section.options
    return (
      <>
        {options.map((option) => {
          const filter = `${section.id}:${option.value}`
          return (
            <label key={filter} className={option.disabled ? 'facet-option facet-option--disabled' : 'facet-option'}>
              <input
                type="checkbox"
                checked={selected.includes(filter)}
                disabled={option.disabled}
                onChange={() => onToggle(filter)}
              />
              <span>{option.label} ({option.count})</span>
            </label>
          )
        })}
        {section.expandable && (
          <button
            className="facet-show-more"
            type="button"
            onClick={() => setExpandedSections((shown) => shown.includes(section.id)
              ? shown.filter((id) => id !== section.id)
              : [...shown, section.id])}
          >
            {expanded ? <ChevronDown className="facet-show-more__up" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {expanded ? 'Show less' : `Show ${section.options.length - options.length} more`}
          </button>
        )}
      </>
    )
  }

  return (
    <aside className={`facet-sidebar${mobile ? ' facet-sidebar--mobile' : ''}`} aria-label="Refine results">
      <div className="facet-sidebar__heading">
        <h2>Refine results</h2>
        {mobile && (
          <button type="button" onClick={onClose} aria-label="Close filters"><X aria-hidden="true" /></button>
        )}
      </div>
      {sections.map((section) => {
        if (section.collapsed) {
          return (
            <details className="facet-collapsed" key={section.id}>
              <summary>{section.label}<Plus aria-hidden="true" /></summary>
              <div className="facet-section__options">{renderOptions(section)}</div>
            </details>
          )
        }
        return (
          <fieldset className="facet-section" key={section.id}>
            <legend>
              {section.label}
              <span title={`${section.label} facet`}><Info aria-hidden="true" /></span>
            </legend>
            {renderOptions(section)}
          </fieldset>
        )
      })}
      <button className="clear-filters" type="button" onClick={onClear}>Clear all filters</button>
    </aside>
  )
}
