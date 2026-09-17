import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PRIORITY_RESEARCH_QUESTIONS } from '../data/researchNavigator'
import { EvidenceStateLegend, PriorityResearchBrief, PriorityResearchCatalog } from './PriorityResearchNavigator'

function render(element: React.ReactElement) {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/search?q=HCRIS'] }, element))
}

describe('priority research navigator surfaces', () => {
  it('renders all 20 searchable question links on the home catalog', () => {
    const markup = render(createElement(PriorityResearchCatalog))
    expect(markup.match(/class="priority-question-card"/g)).toHaveLength(20)
    expect(markup).toContain('cms-hcris')
    expect(markup).toContain('ahrq-hcup')
    expect(markup).toContain('Named source gap')
    expect(markup).toContain('candidate-only records remain explicitly labeled')
  })

  it('renders source dimensions, evidence states, next action, and packet action for a gap', () => {
    const question = PRIORITY_RESEARCH_QUESTIONS.find((item) => item.id === 'hrsa-workforce')!
    const markup = render(createElement(PriorityResearchBrief, { question }))
    expect(markup).toContain('Download evidence packet')
    expect(markup).toContain('Why this matches')
    expect(markup).toContain('Population / entity')
    expect(markup).toContain('Variables / dictionary')
    expect(markup).toContain('Access / cost / account')
    expect(markup).toContain('IDs / joins')
    expect(markup).toContain('Next action:')
    expect(markup).toContain('Open official discovery route')
    expect(markup).toContain('data-evidence-state="unknown"')
    expect(markup).toContain('data-priority-packet')
  })

  it('links an indexed brief to its actual source detail route', () => {
    const question = PRIORITY_RESEARCH_QUESTIONS.find(item => item.id === 'hospital-finance-hcris')!
    const markup = render(createElement(PriorityResearchBrief, { question }))
    expect(markup).toContain('View source details')
    expect(markup).toContain('?return=')
    expect(markup).toContain('search-result-navigator-cms-hcris')
    expect(markup).toContain('/datasets/obs%3Aasset%3Acms-data-catalog%3A')
    expect(markup).toContain('<summary>Evidence references</summary>')
  })

  it('keeps the complete evidence-state legend available to researchers', () => {
    const markup = render(createElement(EvidenceStateLegend))
    expect(markup).toContain('Publisher documented')
    expect(markup).toContain('USHSO observed')
    expect(markup).toContain('Successfully tested')
    expect(markup).toContain('Provisional')
    expect(markup).toContain('Conflicting')
    expect(markup).toContain('Unknown')
  })
})
