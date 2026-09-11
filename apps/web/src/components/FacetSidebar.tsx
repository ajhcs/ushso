import { ChevronDown, Info, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { facetFilterLabel } from '../data/facets'
import type { FacetSectionConfig } from '../types/catalog'

interface FacetSidebarProps {
  selected: string[]
  onToggle: (filter: string) => void
  onClear: () => void
  sections: FacetSectionConfig[]
  mobile?: boolean
  onClose?: () => void
}

function availabilityId(instanceId: string, sectionId: string) {
  const safeInstanceId = instanceId.replace(/[^a-z0-9]+/gi, '-')
  const safeSectionId = sectionId.replace(/[^a-z0-9]+/gi, '-')
  return 'facet-' + safeInstanceId + '-' + safeSectionId + '-availability'
}

function selectedLabel(filter: string, sections: FacetSectionConfig[]) {
  for (const section of sections) {
    const separator = filter.indexOf(':')
    const sectionId = separator > 0 ? filter.slice(0, separator) : filter
    const value = separator > 0 ? filter.slice(separator + 1) : ''
    const option = section.id === sectionId && section.options.find((candidate) => candidate.value === value)
    if (option) return option.label
  }
  return facetFilterLabel(filter)
}

export function FacetSidebar({ selected, onToggle, onClear, sections, mobile = false, onClose }: FacetSidebarProps) {
  const instanceId = useId()
  const [expandedSections, setExpandedSections] = useState<string[]>([])

  const renderAvailability = (section: FacetSectionConfig) => section.availabilityReason
    ? <p className="facet-section__availability" id={availabilityId(instanceId, section.id)} role="note">{section.availabilityReason}</p>
    : null

  const renderOptions = (section: FacetSectionConfig) => {
    const expanded = expandedSections.includes(section.id)
    const options = section.expandable && !expanded ? section.options.slice(0, 5) : section.options
    const reasonId = section.availabilityReason ? availabilityId(instanceId, section.id) : undefined
    return (
      <>
        {options.map((option) => {
          const filter = section.id + ':' + option.value
          const isSelected = selected.includes(filter)
          const isDisabled = Boolean(option.disabled && !isSelected)
          const count = typeof option.count === 'number' ? ' (' + option.count + ')' : ''
          const accessibleName = section.label + ': ' + option.label + (isSelected ? ', selected' : '') + (section.availabilityReason ? '. ' + section.availabilityReason : '')
          return (
            <label key={filter} className={isDisabled ? 'facet-option facet-option--disabled' : 'facet-option'}>
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isDisabled}
                aria-label={accessibleName}
                {...(reasonId ? { 'aria-describedby': reasonId } : {})}
                onChange={() => onToggle(filter)}
              />
              <span>{option.label}{count}</span>
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
            {expanded ? 'Show less' : 'Show ' + (section.options.length - options.length) + ' more'}
          </button>
        )}
      </>
    )
  }

  return (
    <aside className={'facet-sidebar' + (mobile ? ' facet-sidebar--mobile' : '')} aria-label="Refine results">
      <div className="facet-sidebar__heading">
        <h2>Refine results</h2>
        {mobile && (
          <button type="button" onClick={onClose} aria-label="Close filters"><X aria-hidden="true" /></button>
        )}
      </div>
      {selected.length > 0 && (
        <section className="facet-selected" aria-label="Selected filters">
          <h3>Selected filters</h3>
          <ul>
            {selected.map((filter) => (
              <li key={filter}>
                <span>{selectedLabel(filter, sections)}</span>
                <button type="button" aria-label={'Remove ' + selectedLabel(filter, sections) + ' filter'} onClick={() => onToggle(filter)}>
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sections.map((section) => {
        if (section.collapsed) {
          return (
            <details className="facet-collapsed" key={section.id}>
              <summary>{section.label}<Plus aria-hidden="true" /></summary>
              <div className="facet-section__options">{renderAvailability(section)}{renderOptions(section)}</div>
            </details>
          )
        }
        return (
          <fieldset className="facet-section" key={section.id}>
            <legend>
              {section.label}
              <span title={section.label + ' facet'}><Info aria-hidden="true" /></span>
            </legend>
            {renderAvailability(section)}
            {renderOptions(section)}
          </fieldset>
        )
      })}
      <button className="clear-filters" type="button" onClick={onClear}>Clear all filters</button>
    </aside>
  )
}
