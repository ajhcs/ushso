import { canonicalJson, deepClone, deterministicId, sha256 } from '../canonical.mjs';
import { assertResponseCardinality, responseLimitsForDescriptor, validateDescriptor } from '../route-manifest.mjs';

function tupleCompare(a, b) {
  const time = String(a.publisherModifiedAt ?? '').localeCompare(String(b.publisherModifiedAt ?? ''));
  return time || String(a.nativeId).localeCompare(String(b.nativeId));
}

export function normalizedSourceTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('Source publisher timestamp is invalid.');
  const milliseconds = typeof value === 'number'
    ? (value < 100_000_000_000 ? value * 1000 : value)
    : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError('Source publisher timestamp is invalid.');
  return new Date(milliseconds).toISOString();
}

export function validOptionalSourceTimestamp(value) {
  try { normalizedSourceTimestamp(value); return true; } catch { return false; }
}

export class CatalogConnectorBase {
  constructor({ descriptor, endpointId, templateId, pageSize = 100 }) {
    this._descriptor = validateDescriptor(descriptor);
    this.endpointId = endpointId;
    this.templateId = templateId;
    this.pageSize = pageSize;
  }

  descriptor() {
    return deepClone(this._descriptor);
  }

  responseLimits() {
    return responseLimitsForDescriptor(this._descriptor);
  }

  assertRecordCount(records) {
    return assertResponseCardinality(records, this.responseLimits().maximum_records, 'records', 'RECORD_CARDINALITY_EXCEEDED');
  }

  assertLinkCount(links) {
    return assertResponseCardinality(links, this.responseLimits().maximum_links, 'links', 'LINK_CARDINALITY_EXCEEDED');
  }

  assertObservationCount(observations) {
    return assertResponseCardinality(observations, this.responseLimits().maximum_observations, 'observations', 'OBSERVATION_CARDINALITY_EXCEEDED');
  }

  async plan(checkpoint, {
    scheduledSlot,
    mode = checkpoint ? 'incremental' : 'full_membership',
    createdAt = scheduledSlot,
  }) {
    const descriptor = this.descriptor();
    const endpoint = descriptor.endpoints.find((candidate) => candidate.endpoint_id === this.endpointId);
    const deadlineAt = new Date(new Date(scheduledSlot).getTime() + descriptor.bounds.maximum_run_seconds * 1000).toISOString();
    return {
      contract_version: 'ingestion.v1.0.0',
      plan_id: deterministicId('plan', { source: descriptor.source_id, endpoint: this.endpointId, scheduledSlot, mode, revision: descriptor.configuration_revision }),
      source_id: descriptor.source_id,
      endpoint_id: this.endpointId,
      source_configuration_revision: descriptor.configuration_revision,
      mode,
      scheduled_slot: scheduledSlot,
      scope_ids: descriptor.scopes.filter((scope) => scope.endpoint_ids.includes(endpoint.endpoint_id)).map((scope) => scope.scope_id),
      prior_checkpoint_id: checkpoint?.checkpoint_id ?? null,
      prior_checkpoint_digest: checkpoint?.checkpoint_digest ?? null,
      conditional_http: {
        enabled: true,
        reuse_not_modified_capture: true,
        validator_source: checkpoint ? 'checkpoint_capture' : 'none',
      },
      bounded_by: {
        maximum_pages: descriptor.bounds.maximum_pages,
        maximum_response_bytes: descriptor.bounds.maximum_response_bytes,
        maximum_decompressed_bytes: descriptor.bounds.maximum_decompressed_bytes,
        deadline_at: deadlineAt,
      },
      created_at: createdAt,
    };
  }

  initialRequest() {
    throw new Error('Adapter must implement initialRequest().');
  }

  parsePage() {
    throw new Error('Adapter must implement parsePage().');
  }

  responseProfile() {
    throw new Error('Adapter must implement responseProfile().');
  }

  normalize(observation) {
    const normalized = {
      proposal_kind: 'native_metadata_proposal',
      source_id: this._descriptor.source_id,
      native_namespace: this._descriptor.native_identifier.namespace,
      native_id: observation.nativeId,
      publisher_modified_at: observation.publisherModifiedAt,
      source_revision: observation.sourceRevision,
      tombstone: observation.tombstone,
      metadata: deepClone(observation.metadata),
      source_locator: deepClone(observation.sourceLocator),
      normalizer_version: this._descriptor.connector_version,
    };
    return { ...normalized, proposal_digest: sha256(canonicalJson(normalized)) };
  }

  schemaTargets(normalizeResult) {
    return (normalizeResult.metadata.schema_urls ?? []).map((url) => ({
      native_id: normalizeResult.native_id,
      purpose: 'schema',
      locator: url,
      execution_authorized: false,
    }));
  }

  probe(target) {
    return {
      target,
      purpose: 'access_probe',
      method: 'HEAD',
      execution_authorized: false,
      note: 'The shared runner may execute this manifest-bound observation; the adapter does not execute it.',
    };
  }

  proposeCheckpoint(completedRun) {
    if (!completedRun?.sealed || completedRun.failure || completedRun.cursorExpired) {
      throw new Error('A checkpoint can be proposed only from a complete sealed enumeration.');
    }
    const descriptor = this._descriptor;
    const strategy = descriptor.checkpoint_policy.strategy;
    const sorted = [...completedRun.items].sort(tupleCompare);
    const last = sorted.at(-1) ?? null;
    if (strategy === 'modified_at_native_id' && (!last?.publisherModifiedAt || !last?.nativeId)) {
      throw new Error('A modified_at_native_id checkpoint requires a terminal publisher-modified/native-id tuple.');
    }
    if (strategy === 'opaque_cursor' && !completedRun.committedCursorRefId) {
      throw new Error('An opaque_cursor checkpoint requires a committed opaque cursor reference.');
    }
    if (strategy === 'full_snapshot' && !Number.isSafeInteger(completedRun.fullEnumerationSequence)) {
      throw new Error('A full_snapshot checkpoint requires an integer full-enumeration sequence.');
    }
    const position = {
      publisher_modified_at: strategy === 'modified_at_native_id' ? last?.publisherModifiedAt ?? null : null,
      native_id: strategy === 'modified_at_native_id' ? last?.nativeId ?? null : null,
      opaque_cursor_ref_id: strategy === 'opaque_cursor' ? completedRun.committedCursorRefId : null,
      full_enumeration_sequence: strategy === 'full_snapshot' ? completedRun.fullEnumerationSequence : null,
    };
    return {
      strategy,
      position: { ...position, position_digest: sha256(canonicalJson(position)) },
    };
  }

  nativeObservation(item, index, capture) {
    const nativeId = this.nativeId(item);
    if (typeof nativeId !== 'string' || nativeId.length < 1 || nativeId.length > 500) throw new TypeError('Source-native identifier is invalid or excessive.');
    const publisherModifiedAt = normalizedSourceTimestamp(this.publisherModifiedAt(item));
    const sourceRevision = sha256(canonicalJson(item));
    return {
      nativeId,
      publisherModifiedAt,
      sourceRevision,
      tombstone: Boolean(item.deleted || item.tombstone || item.state === 'deleted'),
      metadata: deepClone(item),
      sourceLocator: {
        captureRefId: capture.capture_ref_id,
        r2Key: capture.r2_key,
        rawSha256: capture.raw_sha256,
        redactedLocator: capture.source_locator.redacted_locator,
        nativePointer: this.nativePointer(index),
      },
    };
  }

  nativeId() {
    throw new Error('Adapter must implement nativeId().');
  }

  publisherModifiedAt(item) {
    return item.modified ?? item.metadata?.updatedAt ?? null;
  }

  nativePointer(index) {
    return `/items/${index}`;
  }
}
