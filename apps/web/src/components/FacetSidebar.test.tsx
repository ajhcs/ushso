import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FacetSidebar } from './FacetSidebar'

const sections = [{
  id: 'geography',
  label: 'Geography',
  availability: 'unavailable' as const,
  availabilityReason: 'All matching records have unresolved geography in this catalog scope; no geography-specific narrowing is available.',
  options: [
    { value: 'unknown', label: 'Include records with unresolved geography (if present)', disabled: true },
    { value: 'US-PA', label: 'Pennsylvania', count: 0 },
  ],
}]

describe('FacetSidebar accessibility and bounded availability', () => {
  it('renders no-count include-unknown controls and binds each input to its reason', () => {
    const markup = renderToStaticMarkup(createElement(FacetSidebar, {
      selected: ['geography:US-PA'],
      sections,
      onToggle: () => undefined,
      onClear: () => undefined,
    }))

    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1]
    if (!describedBy) throw new Error('expected a described-by relationship')
    expect(markup).toContain('Include records with unresolved geography (if present)')
    expect(markup).not.toContain('Include records with unresolved geography (if present) (0)')
    expect(markup).toContain('All matching records have unresolved geography')
    expect(markup).toContain('id="' + describedBy + '"')
    expect(markup).not.toContain('aria-describedby="facet-geography-availability"')
    expect(markup).toContain('aria-label="Geography: Pennsylvania, selected. All matching records')
    expect(markup).toContain('Selected filters')
    expect(markup).toContain('Remove Pennsylvania filter')
    expect(markup).toContain('aria-label="Geography: Include records with unresolved geography (if present).')
    expect(markup).toMatch(/facet-option facet-option--disabled[^>]*>.*Include records with unresolved geography/)
    expect(markup).not.toMatch(/aria-label="Geography: Pennsylvania, selected[^>]*disabled/)
  })

  it('uses unique described-by IDs for two rendered sidebar instances', () => {
    const markup = renderToStaticMarkup(createElement('div', null,
      createElement(FacetSidebar, { selected: [], sections, onToggle: () => undefined, onClear: () => undefined }),
      createElement(FacetSidebar, { selected: [], sections, onToggle: () => undefined, onClear: () => undefined }),
    ))
    const availabilityIds = [...markup.matchAll(/id="([^"]+-availability)"/g)].map((match) => match[1])
    const describedByIds = [...markup.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1])
    expect(availabilityIds).toHaveLength(2)
    expect(new Set(availabilityIds).size).toBe(2)
    expect(new Set(describedByIds)).toEqual(new Set(availabilityIds))
  })
})
