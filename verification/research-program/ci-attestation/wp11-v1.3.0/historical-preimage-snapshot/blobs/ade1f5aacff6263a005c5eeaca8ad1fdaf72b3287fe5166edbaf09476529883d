import { describe, expect, it } from 'vitest'
import validPlans from '../../../../contracts/research-plan/v1.0.0/fixtures/valid-plans.json'
import type { CanonicalResearchPlan } from '../types/researchPlan'
import { createBoundedPlanJson, MAX_PLAN_JSON_EXPORT_BYTES } from './planExport'
import { assertCanonicalResearchPlanSurface } from './researchPlanContract'

const plans = validPlans.plans as unknown as CanonicalResearchPlan[]

describe('bounded canonical plan JSON export', () => {
  it('round-trips every frozen canonical status without adding transport or question fields', () => {
    for (const plan of plans) {
      assertCanonicalResearchPlanSurface(plan)
      const exported = createBoundedPlanJson(plan)
      expect(exported.byteLength).toBeLessThanOrEqual(MAX_PLAN_JSON_EXPORT_BYTES)
      expect(JSON.parse(exported.json)).toEqual(plan)
      expect(exported.filename).toMatch(/^ushso-research-plan-[a-f0-9]{20}\.json$/)
      expect(Object.hasOwn(JSON.parse(exported.json), 'question')).toBe(false)
      expect(Object.hasOwn(JSON.parse(exported.json), 'request_id')).toBe(false)
    }
  })

  it('fails closed when a canonical-shaped export exceeds the browser bound', () => {
    const oversized = structuredClone(plans.find((plan) => plan.plan_status === 'ready'))!
    oversized.response.summary = 'x'.repeat(MAX_PLAN_JSON_EXPORT_BYTES)
    expect(() => createBoundedPlanJson(oversized)).toThrow(RangeError)
  })
})
