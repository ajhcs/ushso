/**
 * This is a direct module import of the immutable retrieval v1.0.1 response.
 * FixtureDiscoveryProvider performs runtime contract validation before use.
 */
export async function loadAcceptedDiscoveryFixture(): Promise<unknown> {
  const module = await import('../../../../packages/retrieval/fixtures/responses/q-pa-hospital-finance-utilization.json')
  return module.default
}

export const acceptedDiscoveryFixtureSource = {
  package: 'observatory/retrieval/v1.0.1',
  response: 'fixtures/responses/q-pa-hospital-finance-utilization.json',
  response_sha256: 'de1c31273399777f0b82faba4e876f4a90464c1f1b2cfba5c67d3588b652b6c3',
  corpus_manifest_sha256: '5622272ded52b0cbf039da47114142f8cb35ba634e8a6bbb9ee55b0ecd70511c',
} as const
