import { canonicalJson, sha256 } from '../../connectors/src/canonical.mjs';
import {
  compileManifestRequest,
  validateDescriptor
} from '../../connectors/src/route-manifest.mjs';
import { validateIngestionRecord } from '../../../contracts/ingestion/v1.1.0/tools/index.mjs';
import { deterministicOpaqueId } from './common.mjs';
import { deterministicRunId, runIdempotencyKey } from './scheduler.mjs';

export const COLLECTION_JOB_VERSION = 'ushso.collection-job.v1';
export const DESCRIPTOR_HASH_BASIS = 'ushso-canonical-json.v1';
export class LocalCollectionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LocalCollectionError';
    this.code = code;
  }
}
export function requireLocal(condition, code) {
  if (!condition) throw new LocalCollectionError(code);
}
export function blocked(code) {
  return {
    kind: 'blocked',
    status: 'blocked',
    code,
    next_action:
      'Inspect the pinned fixture configuration or retained checkpoint; no automatic live fallback.'
  };
}
export function exactKeys(value, names, code = 'INVALID_FIELDS') {
  requireLocal(value && Object.getPrototypeOf(value) === Object.prototype, code);
  const keys = Object.keys(value).sort();
  requireLocal(canonicalJson(keys) === canonicalJson([...names].sort()), code);
}
export function assertJson(value) {
  let count = 0;
  function visit(item, depth) {
    requireLocal(++count <= 20000 && depth <= 32, 'JSON_BOUND_EXCEEDED');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number') {
      requireLocal(Number.isFinite(item), 'JSON_NUMBER_INVALID');
      return;
    }
    requireLocal(item && typeof item === 'object', 'JSON_VALUE_INVALID');
    requireLocal(
      (Array.isArray(item) && Object.getPrototypeOf(item) === Array.prototype) ||
        Object.getPrototypeOf(item) === Object.prototype,
      'JSON_OBJECT_INVALID'
    );
    if (Array.isArray(item)) {
      requireLocal(
        Reflect.ownKeys(item).length === item.length + 1 &&
          Object.keys(item).length === item.length,
        'JSON_ARRAY_NOT_DENSE'
      );
      for (let index = 0; index < item.length; index++)
        requireLocal(Object.hasOwn(item, index), 'JSON_ARRAY_NOT_DENSE');
    } else
      requireLocal(
        Reflect.ownKeys(item).length === Object.keys(item).length,
        'JSON_HIDDEN_PROPERTY'
      );
    for (const key of Object.keys(item)) {
      requireLocal(
        !['__proto__', 'constructor', 'prototype'].includes(key),
        'JSON_PROPERTY_INVALID'
      );
      requireLocal(
        !('get' in Object.getOwnPropertyDescriptor(item, key)) &&
          !('set' in Object.getOwnPropertyDescriptor(item, key)),
        'JSON_ACCESSOR_INVALID'
      );
      visit(item[key], depth + 1);
    }
  }
  visit(value, 0);
}

const FIELDS = [
  'source_id',
  'descriptor_id',
  'configuration_revision',
  'descriptor_sha256',
  'endpoint_id',
  'template_id',
  'scope_id',
  'scheduled_slot',
  'mode',
  'selected_record_ids',
  'capture_class',
  'budget_reservation',
  'fixture_manifest_sha256'
];
const BUDGET_FIELDS = [
  'reservation_id',
  'policy_sha256',
  'maximum_requests',
  'maximum_response_bytes',
  'maximum_decompressed_bytes',
  'maximum_total_bytes',
  'timeout_ms'
];
const HEX = /^[a-f0-9]{64}$/;

/** The registry port is supplied by the composition root, never by job JSON. */
export async function admitCollectionJob(
  input,
  { resolveApprovedDescriptor, registrySha256, policySha256, policy } = {}
) {
  try {
    assertJson(input);
    exactKeys(input, FIELDS, 'JOB_FIELDS_INVALID');
    requireLocal(
      typeof resolveApprovedDescriptor === 'function' && HEX.test(registrySha256 ?? ''),
      'APPROVED_REGISTRY_REQUIRED'
    );
    requireLocal(
      HEX.test(policySha256 ?? '') && policy?.lifecycle === 'fixture_only',
      'POLICY_CONTEXT_REQUIRED'
    );
    requireLocal(
      Object.values(policy.activation ?? {}).length === 8 &&
        Object.values(policy.activation).every((value) => value === false),
      'ACTIVATION_FORBIDDEN'
    );
    requireLocal(input.source_id === 'source_fixture_catalog', 'SOURCE_NOT_FIXTURE');
    requireLocal(
      HEX.test(input.descriptor_sha256 ?? '') && HEX.test(input.fixture_manifest_sha256 ?? ''),
      'HASH_INVALID'
    );
    requireLocal(
      typeof input.scheduled_slot === 'string' &&
        Number.isFinite(Date.parse(input.scheduled_slot)) &&
        new Date(input.scheduled_slot).toISOString() === input.scheduled_slot,
      'SCHEDULE_SLOT_INVALID'
    );
    requireLocal(input.mode === 'full_membership', 'MODE_NOT_SUPPORTED');
    requireLocal(input.capture_class === 'catalog_metadata', 'CAPTURE_CLASS_NOT_SUPPORTED');
    const resolved = await resolveApprovedDescriptor({
      sourceId: input.source_id,
      descriptorId: input.descriptor_id,
      configurationRevision: input.configuration_revision,
      endpointId: input.endpoint_id,
      templateId: input.template_id,
      scopeId: input.scope_id
    });
    requireLocal(
      resolved?.kind === 'resolved' && resolved.approvalScope === 'fixture_only',
      'DESCRIPTOR_NOT_APPROVED'
    );
    requireLocal(
      resolved.registrySha256 === registrySha256 &&
        resolved.hashBasis === DESCRIPTOR_HASH_BASIS &&
        typeof resolved.registryEvidenceRef === 'string' &&
        resolved.registryEvidenceRef.length > 0,
      'REGISTRY_EVIDENCE_MISMATCH'
    );
    assertJson(resolved.descriptor);
    const descriptor = validateDescriptor(resolved.descriptor);
    requireLocal(
      (await validateIngestionRecord('source-descriptor.schema.json', descriptor)).valid,
      'DESCRIPTOR_SCHEMA_INVALID'
    );
    requireLocal(
      descriptor.source_id === input.source_id &&
        descriptor.descriptor_id === input.descriptor_id &&
        descriptor.configuration_revision === input.configuration_revision,
      'DESCRIPTOR_IDENTITY_MISMATCH'
    );
    requireLocal(descriptor.source_state === 'active', 'FIXTURE_DESCRIPTOR_NOT_ACTIVE');
    const hash = sha256(canonicalJson(descriptor));
    requireLocal(
      hash === input.descriptor_sha256 && hash === resolved.registeredDescriptorSha256,
      'DESCRIPTOR_HASH_MISMATCH'
    );
    requireLocal(
      resolved.fixtureManifestSha256 === input.fixture_manifest_sha256,
      'FIXTURE_MANIFEST_MISMATCH'
    );
    const scope = descriptor.scopes.find((item) => item.scope_id === input.scope_id);
    requireLocal(scope?.endpoint_ids.includes(input.endpoint_id), 'SCOPE_MISMATCH');
    const request = {
      endpointId: input.endpoint_id,
      templateId: input.template_id,
      purpose: 'catalog_metadata',
      method: 'GET',
      targetClass: 'collection',
      pathParameters: {},
      query: {}
    };
    compileManifestRequest(descriptor, request);
    requireLocal(
      Array.isArray(input.selected_record_ids) &&
        input.selected_record_ids.length > 0 &&
        input.selected_record_ids.length <= 2 &&
        input.selected_record_ids.every(
          (id) => typeof id === 'string' && resolved.recordIds?.includes(id)
        ),
      'SELECTED_RECORDS_INVALID'
    );
    requireLocal(
      new Set(input.selected_record_ids).size === input.selected_record_ids.length,
      'SELECTED_RECORDS_DUPLICATE'
    );
    const budget = input.budget_reservation;
    exactKeys(budget, BUDGET_FIELDS, 'BUDGET_FIELDS_INVALID');
    requireLocal(
      /^reservation_[a-z0-9_-]{1,80}$/.test(budget.reservation_id ?? '') &&
        budget.policy_sha256 === policySha256,
      'BUDGET_IDENTITY_INVALID'
    );
    for (const key of BUDGET_FIELDS.filter(
      (key) => !['reservation_id', 'policy_sha256'].includes(key)
    ))
      requireLocal(Number.isSafeInteger(budget[key]) && budget[key] > 0, 'BUDGET_LIMIT_INVALID');
    requireLocal(
      budget.maximum_requests <= descriptor.bounds.maximum_pages &&
        budget.maximum_response_bytes <= descriptor.bounds.maximum_response_bytes &&
        budget.maximum_decompressed_bytes <= descriptor.bounds.maximum_decompressed_bytes &&
        budget.maximum_total_bytes <=
          descriptor.bounds.maximum_pages * descriptor.bounds.maximum_response_bytes &&
        budget.timeout_ms <=
          Math.min(
            policy.global_bounds.timeout_seconds * 1000,
            descriptor.bounds.maximum_run_seconds * 1000
          ),
      'BUDGET_EXCEEDS_POLICY'
    );
    const identity = {
      ...structuredClone(input),
      selected_record_ids: [...input.selected_record_ids].sort(),
      descriptor_hash_basis: DESCRIPTOR_HASH_BASIS,
      collector_identity: 'research-capture+dcat-data-json.v1',
      registry_sha256: registrySha256
    };
    const collectionJobId = `collection_${sha256(canonicalJson(identity))}`;
    const parentInput = {
      endpointId: input.endpoint_id,
      scheduledSlot: input.scheduled_slot,
      mode: input.mode,
      configurationRevision: input.configuration_revision
    };
    return {
      kind: 'admitted',
      job: {
        format: COLLECTION_JOB_VERSION,
        collection_job_id: collectionJobId,
        parent_run_id: await deterministicRunId(parentInput),
        parent_run_idempotency_key: runIdempotencyKey(parentInput),
        execution_run_id: await deterministicOpaqueId('run', {
          kind: 'ushso.collection-execution.v1',
          collectionJobId
        }),
        attempt: 1,
        identity,
        descriptor,
        initial_request: request,
        registry_evidence_ref: resolved.registryEvidenceRef,
        activation: {
          local_fixture_persistence: true,
          live_network: false,
          managed_persistence: false,
          production_composition: false
        }
      }
    };
  } catch (error) {
    return blocked(
      error instanceof LocalCollectionError ? error.code : 'COLLECTION_ADMISSION_INVALID'
    );
  }
}
