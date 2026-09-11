import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FacetSidebar } from './FacetSidebar'

describe('FacetSidebar accessibility and bounded availability', () => {
  it('renders no-count include-unknown controls and a removable selected token', () => {
    const markup = renderToStaticMarkup(createElement(FacetSidebar, {
      selected: ['geography:US-PA'],
      sections: [{
        id: 'geography',
        label: 'Geography',
        availability: 'unavailable',
        availabilityReason: 'All matching records have unresolved geography in this catalog scope; no geography-specific narrowing is available.',
        options: [
          { value: 'unknown', label: 'Include records with unresolved geography (if present)', disabled: true },
          { value: 'US-PA', label: 'Pennsylvania', count: 0 },
        ],
      }],
      onToggle: () => undefined,
      onClear: () => undefined,
    }))

    expect(markup).toContain('Include records with unresolved geography (if present)')
    expect(markup).not.toContain('Include records with unresolved geography (if present) (0)')
    expect(markup).toContain('All matching records have unresolved geography')
    expect(markup).toContain('aria-describedby=\"facet-geography-availability\"')
    expect(markup).toContain('aria-label=\"Geography: Pennsylvania, selected. All matching records')
    expect(markup).toContain('Selected filters')
    expect(markup).toContain('Remove Pennsylvania filter')
    expect(markup).toContain('aria-label="Geography: Include records with unresolved geography (if present).')
    expect(markup).toMatch(/facet-option facet-option--disabled[^>]*>.*Include records with unresolved geography/)
    expect(markup).not.toMatch(/aria-label="Geography: Pennsylvania, selected[^>]*disabled/)
  })
})
