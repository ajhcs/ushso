import { readFile } from 'node:fs/promises';
import { canonicalJson, deepFreeze, sha256 } from '../../connectors/src/canonical.mjs';
import { makeFixtureDescriptor } from '../../connectors/src/testing/fixtures.mjs';
import { APPROVED_SOURCE_DESCRIPTOR_TEMPLATES } from '../../connectors/src/descriptors.mjs';
import { DEFAULT_RESPONSE_LIMITS, routeManifestInventory, validateDescriptor } from '../../connectors/src/route-manifest.mjs';
import { STAGE_POLICIES, retryBudget } from './failure-policy.mjs';
import { DLQ_SINK_TRANSPORT_POLICY } from './dlq-sink-policy.mjs';
import { validateOperatingBoundsPolicy } from '../../../scripts/research-program/operating-bounds.mjs';
import { DESCRIPTOR_HASH_BASIS, requireLocal } from './collection-job.mjs';

export const FIXTURE_ID = 'catalog-two-page-v1';
export const FIXTURE_SLOT = '2026-09-12T00:00:00.000Z';
export const FIXTURE_CLOCK = deepFreeze({ basis: 'fixture-logical-clock.v1', page_spacing_ms: 1000, recorded_offset_ms: 1 });
export const JOURNAL_BOUNDS = deepFreeze({ maximum_children: 8, maximum_records: 2048, maximum_record_bytes: 262144, maximum_object_bytes: 262144, maximum_total_object_bytes: 8388608, maximum_total_deliveries: 16, maximum_replays: 64 });

function fixtureDescriptor() {
  const descriptor = makeFixtureDescriptor({ sourceId: 'source_fixture_catalog', sourceState: 'active', maximumPages: 2, maximumResponseBytes: 4096, maximumDecompressedBytes: 4096, maximumRedirects: 0, redirectPolicy: 'deny' });
  descriptor.endpoints = [descriptor.endpoints.find(endpoint => endpoint.endpoint_id === 'endpoint_fixture_catalog')];
  descriptor.endpoints[0].routes[0].allowed_parameters = ['cursor'];
  descriptor.scopes[0].endpoint_ids = ['endpoint_fixture_catalog'];
  descriptor.bounds.maximum_run_seconds = 30;
  descriptor.origin_policy.maximum_concurrency = 1;
  descriptor.origin_policy.requests_per_second = 1;
  descriptor.origin_policy.burst = 1;
  return validateDescriptor(descriptor);
}

export const FIXTURE_DESCRIPTOR = deepFreeze(fixtureDescriptor());
export const FIXTURE_MANIFEST = deepFreeze({
  format: 'ushso.local-fixture.v1', fixture_id: FIXTURE_ID, source_id: 'source_fixture_catalog', record_ids: ['fixture-record-a', 'fixture-record-b'], clock: FIXTURE_CLOCK, journal_bounds: JOURNAL_BOUNDS,
  pages: [
    { url: 'https://catalog.example.gov/data.json', body: { dataset: [{ identifier: 'fixture-record-a', title: 'Synthetic fixture A', modified: '2026-09-10T00:00:00.000Z' }], next_cursor: 'page-2' } },
    { url: 'https://catalog.example.gov/data.json?cursor=page-2', body: { dataset: [{ identifier: 'fixture-record-b', title: 'Synthetic fixture B', modified: '2026-09-11T00:00:00.000Z' }] } },
  ],
  fixture_only: true, publication_authorized: false,
});

export function createFixtureRegistry({ descriptor = FIXTURE_DESCRIPTOR, manifest = FIXTURE_MANIFEST, policySha256 } = {}) {
  const snapshot = structuredClone({ descriptor, manifest });
  const registeredDescriptorSha256 = sha256(canonicalJson(snapshot.descriptor));
  const fixtureManifestSha256 = sha256(canonicalJson(snapshot.manifest));
  const registrySha256 = sha256(canonicalJson({ registeredDescriptorSha256, fixtureManifestSha256, policySha256, approvalScope: 'fixture_only' }));
  return {
    registrySha256,
    async resolveApprovedDescriptor(input) {
      if (input.sourceId !== snapshot.descriptor.source_id || input.descriptorId !== snapshot.descriptor.descriptor_id || input.configurationRevision !== snapshot.descriptor.configuration_revision || !snapshot.descriptor.scopes.some(scope => scope.scope_id === input.scopeId && scope.endpoint_ids.includes(input.endpointId)) || !snapshot.descriptor.endpoints.some(endpoint => endpoint.endpoint_id === input.endpointId && endpoint.routes.some(route => route.template_id === input.templateId))) return { kind: 'blocked', code: 'REGISTRY_ITEM_NOT_FOUND' };
      return { kind: 'resolved', descriptor: structuredClone(snapshot.descriptor), registeredDescriptorSha256, fixtureManifestSha256, registrySha256, hashBasis: DESCRIPTOR_HASH_BASIS, approvalScope: 'fixture_only', registryEvidenceRef: 'registry_fixture_catalog_v1', recordIds: [...snapshot.manifest.record_ids] };
    },
  };
}

export async function loadFixtureCatalog(fixtureId = FIXTURE_ID) {
  requireLocal(fixtureId === FIXTURE_ID, 'FIXTURE_NOT_REGISTERED');
  const bytes = await readFile(new URL('../../../scripts/research-program/policy.json', import.meta.url));
  const policy = JSON.parse(bytes);
  const validation = await validateOperatingBoundsPolicy(policy, { descriptors: APPROVED_SOURCE_DESCRIPTOR_TEMPLATES, defaultResponseLimits: DEFAULT_RESPONSE_LIMITS, stagePolicies: STAGE_POLICIES, retryBudget, dlqPolicy: DLQ_SINK_TRANSPORT_POLICY, validateDescriptor, routeManifestInventory });
  requireLocal(validation.valid, 'ACCEPTED_POLICY_INVALID');
  const policySha256 = sha256(bytes);
  const registry = createFixtureRegistry({ policySha256 });
  const input = {
    source_id: FIXTURE_DESCRIPTOR.source_id, descriptor_id: FIXTURE_DESCRIPTOR.descriptor_id, configuration_revision: FIXTURE_DESCRIPTOR.configuration_revision,
    descriptor_sha256: sha256(canonicalJson(FIXTURE_DESCRIPTOR)), endpoint_id: 'endpoint_fixture_catalog', template_id: 'route_fixture_catalog', scope_id: 'scope_fixture_catalog', scheduled_slot: FIXTURE_SLOT, mode: 'full_membership', selected_record_ids: [...FIXTURE_MANIFEST.record_ids], capture_class: 'catalog_metadata',
    budget_reservation: { reservation_id: 'reservation_fixture_v1', policy_sha256: policySha256, maximum_requests: 2, maximum_response_bytes: 4096, maximum_decompressed_bytes: 4096, maximum_total_bytes: 8192, timeout_ms: 1000 },
    fixture_manifest_sha256: sha256(canonicalJson(FIXTURE_MANIFEST)),
  };
  return { fixtureId, input, policy, policySha256, ...registry, descriptor: structuredClone(FIXTURE_DESCRIPTOR), manifest: structuredClone(FIXTURE_MANIFEST) };
}
