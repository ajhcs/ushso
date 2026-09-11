import { assertCanonicalResearchPlanSurface } from './researchPlanContract'
import type { CanonicalResearchPlan } from '../types/researchPlan'

export const MAX_PLAN_JSON_EXPORT_BYTES = 256 * 1024

export interface BoundedPlanJson {
  json: string
  byteLength: number
  filename: string
}

function safePlanFilename(planId: string) {
  const suffix = planId.replace(/^sha256:/, '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
  return `ushso-research-plan-${suffix || 'canonical'}.json`
}

export function createBoundedPlanJson(plan: CanonicalResearchPlan): BoundedPlanJson {
  assertCanonicalResearchPlanSurface(plan)
  const json = `${JSON.stringify(plan, null, 2)}\n`
  const byteLength = new TextEncoder().encode(json).byteLength
  if (byteLength > MAX_PLAN_JSON_EXPORT_BYTES) {
    throw new RangeError(`Canonical plan export is ${byteLength} bytes; the browser limit is ${MAX_PLAN_JSON_EXPORT_BYTES} bytes.`)
  }
  return { json, byteLength, filename: safePlanFilename(plan.plan_id) }
}
