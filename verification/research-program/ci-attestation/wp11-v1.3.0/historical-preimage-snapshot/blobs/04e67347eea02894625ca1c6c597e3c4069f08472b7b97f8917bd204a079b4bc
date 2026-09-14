import type { DiscoveryResult } from '../types/discovery'
import { applyLiveVerificationOverlay } from './liveVerificationOverlay'

export async function loadBaseAcceptedDiscoveryFixture(): Promise<unknown> {
  const module = await import('../../../../packages/retrieval/fixtures/responses/q-pa-hospital-finance-utilization.json')
  return module.default
}

/**
 * The immutable response is cloned and enriched from a separately versioned,
 * complete first-party verification receipt. The published corpus remains
 * untouched and the provider validates the merged contract before use.
 */
export async function loadAcceptedDiscoveryFixture(): Promise<unknown> {
  const [baseModule, receiptModule] = await Promise.all([
    loadBaseAcceptedDiscoveryFixture(),
    import('../../../../verification/v0.1.0/receipts/live-verification-2026-08-30.json'),
  ])
  return applyLiveVerificationOverlay(baseModule as DiscoveryResult, receiptModule.default)
}

export const acceptedDiscoveryFixtureSource = {
  package: 'observatory/retrieval/v1.0.1',
  response: 'fixtures/responses/q-pa-hospital-finance-utilization.json',
  response_sha256: 'de1c31273399777f0b82faba4e876f4a90464c1f1b2cfba5c67d3588b652b6c3',
  corpus_manifest_sha256: '5622272ded52b0cbf039da47114142f8cb35ba634e8a6bbb9ee55b0ecd70511c',
  verification: 'verification/v0.1.0/receipts/live-verification-2026-08-30.json',
  verification_observed_at: '2026-08-30T13:47:55.7164695-04:00',
} as const
