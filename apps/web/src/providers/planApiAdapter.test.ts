import { describe, expect, it, vi } from 'vitest'
import { RESEARCH_PLAN_CONTRACT_ENDPOINT, RESEARCH_PLAN_ENDPOINT } from '../lib/researchPlanContract'
import { BLOCKED_PLAN_FEATURE_GATE, createBlockedPlanApiAdapter, PlanApiUnavailableError } from './planApiAdapter'

describe('blocked plan API adapter seam', () => {
  it('names the exact future endpoints but makes no request while WP10B is blocked', async () => {
    const transport = vi.fn() as unknown as typeof fetch
    const adapter = createBlockedPlanApiAdapter(transport)
    const rawQuestion = 'sensitive research question that must not leave the browser'

    expect(adapter.endpoints).toEqual({ plan: RESEARCH_PLAN_ENDPOINT, contract: RESEARCH_PLAN_CONTRACT_ENDPOINT })
    expect(adapter.featureGate).toBe(BLOCKED_PLAN_FEATURE_GATE)
    expect(adapter.featureGate).toMatchObject({ apiPlanEnabled: false, contractEndpointEnabled: false, compilerRuntimeAuthorized: false, authorizationRequirementId: 'AUTH-12' })
    await expect(adapter.requestPlan({ question: rawQuestion })).rejects.toBeInstanceOf(PlanApiUnavailableError)
    await expect(adapter.readContract()).rejects.toMatchObject({ code: 'planner_dependency_blocked', retryable: false })
    expect(transport).not.toHaveBeenCalled()
  })
})
