import { CircleSlash2, LoaderCircle, TriangleAlert } from 'lucide-react'
import { CanonicalPlanView } from '../components/CanonicalPlanView'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { BLOCKED_PLAN_FEATURE_GATE } from '../providers/planApiAdapter'
import type { PlanSurfaceState } from '../types/researchPlan'

const defaultState: PlanSurfaceState = {
  status: 'blocked',
  code: 'planner_dependency_blocked',
  message: 'Research-plan compilation is not available while the planner governance dependency remains pending. No question is collected, transmitted, or persisted on this page.',
}

export function PlanPage({ state = defaultState }: { state?: PlanSurfaceState }) {
  return (
    <div className="plan-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="plan-page__main">
        {state.status === 'loading' && <div className="plan-surface-state" role="status" aria-busy="true"><LoaderCircle aria-hidden="true" /><h1>Loading a compiled research plan…</h1><p>No source request or plan generation occurs in this browser view.</p></div>}
        {state.status === 'blocked' && <div className="plan-surface-state plan-surface-state--blocked" role="status" data-plan-api-enabled={BLOCKED_PLAN_FEATURE_GATE.apiPlanEnabled}><CircleSlash2 aria-hidden="true" /><p>Research plan</p><h1>Plan compilation is not available yet.</h1><p>{state.message}</p><dl><div><dt>Plan API</dt><dd>Disabled</dd></div><div><dt>Contract endpoint</dt><dd>Reserved; not served by this UI foundation</dd></div><div><dt>Product boundary</dt><dd>Recommendations and instructions only; no acquisition or analysis</dd></div></dl></div>}
        {state.status === 'error' && <div className="plan-surface-state plan-surface-state--error" role="alert"><TriangleAlert aria-hidden="true" /><h1>The compiled plan could not be displayed.</h1><p>{state.message}</p><code>{state.code}</code></div>}
        {state.status === 'ready' && <CanonicalPlanView plan={state.plan} />}
      </main>
      <ObservatoryFooter results={state.status === 'ready'} />
    </div>
  )
}
