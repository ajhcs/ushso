import { describe, expect, it } from 'vitest'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import type { DiscoveryResult } from '../types/discovery'
import { loadAcceptedDiscoveryFixture, loadBaseAcceptedDiscoveryFixture } from './acceptedDiscoveryFixture'
import { applyLiveVerificationOverlay } from './liveVerificationOverlay'

const receiptModule = await import('../../../../verification/v0.1.0/receipts/live-verification-2026-08-30.json')
const base = await loadBaseAcceptedDiscoveryFixture()
assertDiscoveryResult(base)

describe('live verification overlay', () => {
  it('promotes every displayed record using separately persisted first-party evidence', async () => {
    const merged = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(merged)

    expect(merged.results).toHaveLength(15)
    merged.results.forEach(({ record }) => {
      expect(record.freshness_verification).toMatchObject({
        metadata_observed_at: receiptModule.default.observed_at,
        verification_status: 'current_verified',
        verification_method: 'first_party_live',
      })
      expect(record.variable_documentation?.variables.length).toBeGreaterThan(0)
      expect(record.variable_documentation?.evidence_state).toBe('verified_first_party')
      expect(record.evidence.some((item) => item.state === 'verified_first_party')).toBe(true)
      expect(record.provenance.some((item) => item.observed_at === receiptModule.default.observed_at)).toBe(true)
    })
  })

  it('does not mutate the immutable base response', () => {
    expect(base.results.every(({ record }) => record.freshness_verification.verification_status === 'not_live_verified')).toBe(true)
    expect(base.results.every(({ record }) => record.variable_documentation === undefined)).toBe(true)
  })

  it('rejects incomplete receipts instead of partially promoting records', () => {
    const incomplete = structuredClone(receiptModule.default)
    incomplete.records.pop()
    incomplete.scope.record_count = incomplete.records.length

    expect(() => applyLiveVerificationOverlay(base, incomplete)).toThrow(/does not cover every displayed record/)
  })

  it('rejects record and URL mismatches instead of attaching evidence to the wrong asset', () => {
    const wrongRecord = structuredClone(receiptModule.default)
    wrongRecord.records[0].record_id = 'not-in-response'
    expect(() => applyLiveVerificationOverlay(base, wrongRecord)).toThrow(/outside the response/)

    const wrongUrl = structuredClone(receiptModule.default)
    wrongUrl.records[0].authoritative_url = 'https://example.test/not-the-source'
    expect(() => applyLiveVerificationOverlay(base, wrongUrl)).toThrow(/does not exactly match/)
  })
})
