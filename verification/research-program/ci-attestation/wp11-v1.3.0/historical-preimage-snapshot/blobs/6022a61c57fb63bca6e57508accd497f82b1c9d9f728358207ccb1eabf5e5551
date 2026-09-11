import { RESEARCH_PLAN_CONTRACT_ENDPOINT, RESEARCH_PLAN_ENDPOINT } from '../lib/researchPlanContract'

export const BLOCKED_PLAN_FEATURE_GATE = Object.freeze({
  gateVersion: 'ushso-plan-ui-gate.v1.0.0',
  apiPlanEnabled: false,
  contractEndpointEnabled: false,
  compilerRuntimeAuthorized: false,
  dependency: 'WP10B',
  authorizationRequirementId: 'AUTH-12',
  reason: 'The planner benchmark owner-ratification gate has not authorized compiler runtime work.',
})

export class PlanApiUnavailableError extends Error {
  readonly code = 'planner_dependency_blocked'
  readonly retryable = false

  constructor() {
    super('Research-plan compilation is not available. No question was transmitted or persisted.')
    this.name = 'PlanApiUnavailableError'
  }
}

export interface PlanApiAdapter {
  readonly featureGate: typeof BLOCKED_PLAN_FEATURE_GATE
  readonly endpoints: {
    readonly plan: typeof RESEARCH_PLAN_ENDPOINT
    readonly contract: typeof RESEARCH_PLAN_CONTRACT_ENDPOINT
  }
  requestPlan(request: unknown, options?: { signal?: AbortSignal }): Promise<never>
  readContract(options?: { signal?: AbortSignal }): Promise<never>
}

/**
 * WP11 owns only the browser seam. The injected transport is intentionally
 * unreachable while AUTH-12/WP10B remain pending, which makes the no-egress
 * property directly testable without implementing a dormant compiler client.
 */
export function createBlockedPlanApiAdapter(transport: typeof fetch = globalThis.fetch): PlanApiAdapter {
  void transport
  const unavailable = async () => {
    throw new PlanApiUnavailableError()
  }
  return Object.freeze({
    featureGate: BLOCKED_PLAN_FEATURE_GATE,
    endpoints: Object.freeze({ plan: RESEARCH_PLAN_ENDPOINT, contract: RESEARCH_PLAN_CONTRACT_ENDPOINT }),
    requestPlan: async (_request: unknown, _options?: { signal?: AbortSignal }) => unavailable(),
    readContract: async (_options?: { signal?: AbortSignal }) => unavailable(),
  })
}
