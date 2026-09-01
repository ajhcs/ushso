import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import validPlans from '../../../../contracts/research-plan/v1.0.0/fixtures/valid-plans.json'
import App from '../App'
import { PLAN_SECTION_ORDER, assertCanonicalResearchPlanSurface } from '../lib/researchPlanContract'
import type { CanonicalResearchPlan } from '../types/researchPlan'
import { PlanPage } from './PlanPage'

const plans = validPlans.plans as unknown as CanonicalResearchPlan[]
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function renderPlan(plan: CanonicalResearchPlan) {
  return renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(PlanPage, { state: { status: 'ready', plan } })))
}

describe('/plan canonical presentation', () => {
  it('renders every canonical plan status accessibly in the required section order', () => {
    expect(new Set(plans.map((plan) => plan.plan_status))).toEqual(new Set(['unsupported', 'clarification_required', 'incomplete', 'ready_with_constraints', 'ready']))
    for (const plan of plans) {
      assertCanonicalResearchPlanSurface(plan)
      const markup = renderPlan(plan)
      expect(markup).toContain('<main id="main-content"')
      expect(markup).toContain('<h1 id="plan-lead-heading">You need these sources.</h1>')
      expect(markup).toContain(`data-plan-status="${plan.plan_status}"`)
      expect(markup).toContain('role="status"')
      let previous = -1
      for (const section of PLAN_SECTION_ORDER) {
        const position = markup.indexOf(`data-plan-section="${section}"`)
        expect(position).toBeGreaterThan(previous)
        previous = position
      }
      for (const heading of ['plan-lead-heading', 'plan-roles-heading', 'plan-coverage-heading', 'plan-operations-heading', 'plan-acquisition-heading', 'plan-downstream-heading', 'plan-limitations-heading', 'plan-export-heading']) {
        expect(markup).toContain(`aria-labelledby="${heading}"`)
        expect(markup).toContain(`id="${heading}"`)
      }
      expect(markup).toContain('Copy plan JSON')
      expect(markup).toContain('Download plan JSON')
      expect(markup).toContain('Product-owner approval for this public wording remains pending.')
    }
  })

  it('keeps operation kind, evidence, compatibility, requirements, and blockers orthogonal', () => {
    const plan = plans.find((candidate) => candidate.plan_status === 'ready_with_constraints')!
    const markup = renderPlan(plan)
    for (const field of ['operation_kind', 'evidence_state', 'compatibility', 'requirements', 'blockers']) {
      expect(markup).toContain(`data-operation-field="${field}"`)
    }
    expect(markup).toContain('Candidate · basis Candidate')
    expect(markup).toContain('Conditional')
    expect(markup).toContain('Unresolved blockers')
    expect(markup).toContain('Executed</dt><dd>No')
  })

  it('exposes a distinct disabled route without a question form or a synthetic plan', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/plan'] }, createElement(App)))
    expect(markup).toContain('Plan compilation is not available yet.')
    expect(markup).toContain('data-plan-api-enabled="false"')
    expect(markup).toContain('No question is collected, transmitted, or persisted')
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('data-contract-version="observatory-research-plan.v1.0.0"')
  })

  it('has explicit tablet and phone collapse rules for every multi-column plan surface', async () => {
    const css = await readFile(`${repositoryRoot}apps/web/src/styles.css`, 'utf8')
    expect(css).toMatch(/@media \(max-width: 820px\)[\s\S]*\.plan-coverage-grid[\s\S]*grid-template-columns: 1fr/)
    expect(css).toMatch(/@media \(max-width: 820px\)[\s\S]*\.plan-operations dl[\s\S]*grid-template-columns: 1fr/)
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*\.plan-export__actions, \.plan-export__actions button \{ width: 100%/)
  })
})
