import { canonicalJson, deterministicId, semanticSha256, sha256, asBytes } from './canonical.mjs';
import { ConnectorFailure } from './errors.mjs';
import { redactedLocator } from './route-manifest.mjs';

const SAFE_HEADER_NAMES = ['etag', 'last-modified', 'content-type', 'content-length', 'cache-control'];
const HEADER_SECRET_OR_LOCATOR = /https?:\/\/|(?:x-amz|x-goog)-(?:credential|signature)|awsaccesskeyid|googleaccessid|access[_-]?token|api[_-]?key|\bbearer\b|-----BEGIN/i;

function safeOpaqueHeader(value, maximumLength) {
  if (value === null || value.length > maximumLength || /[\u0000-\u001f\u007f]/.test(value) || HEADER_SECRET_OR_LOCATOR.test(value)) return null;
  return value;
}

function safeHttpDate(value) {
  if (value === null || value.length > 128 || /[\r\n]/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toUTCString() : null;
}

function safeHeaders(headers) {
  const value = Object.fromEntries(SAFE_HEADER_NAMES.map((name) => [name, headers.get(name)]));
  const parsedLength = value['content-length'] !== null && /^(?:0|[1-9]\d*)$/.test(value['content-length']) ? Number(value['content-length']) : null;
  const mediaType = (value['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  const cacheControl = safeOpaqueHeader(value['cache-control'], 500);
  return {
    etag: safeOpaqueHeader(value.etag, 512),
    last_modified: safeHttpDate(value['last-modified']),
    content_type: mediaType,
    content_length: Number.isSafeInteger(parsedLength) ? parsedLength : null,
    cache_control: cacheControl && /^[A-Za-z0-9_.*="' ,=-]+$/.test(cacheControl) ? cacheControl : null,
  };
}

function captureClassification(purpose) {
  if (purpose === 'catalog_metadata') return 'catalog_metadata';
  if (purpose === 'schema') return 'schema_metadata';
  if (purpose === 'documentation') return 'documentation';
  throw new TypeError('Access-probe responses are observations and cannot be captured as evidence bodies.');
}

export class R2CaptureProtocol {
  constructor({ objectStore, referenceStore, clock = () => new Date(), crashInjector = null }) {
    if (!objectStore?.putIfAbsent || !referenceStore?.commit) throw new TypeError('Capture ports are required.');
    this.objectStore = objectStore;
    this.referenceStore = referenceStore;
    this.clock = clock;
    this.crashInjector = crashInjector;
  }

  async capture({ descriptor, runId, compiledRequest, finalUrl, headers, wireBytes, bodyBytes, observedAt }) {
    const wire = asBytes(wireBytes ?? bodyBytes);
    const body = asBytes(bodyBytes);
    // The durable capture is the exact bounded, decoded representation that
    // classifiers and normalizers consume. Wire size remains separately
    // accounted so compression cannot hide a decompression bomb.
    const raw = body;
    const rawSha256 = sha256(raw);
    const mediaType = (headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    const semanticHash = semanticSha256(body, mediaType);
    const r2Key = `captures/sha256/${rawSha256.slice(0, 2)}/${rawSha256}`;
    const classification = captureClassification(compiledRequest.purpose);
    const put = await this.objectStore.putIfAbsent(r2Key, raw, {
      sha256: rawSha256,
      contentType: mediaType,
      customMetadata: {
        classification,
        connectorVersion: descriptor.connector_version,
        rawSha256,
      },
    });
    if (!put || put.key !== r2Key || put.sha256 !== rawSha256 || put.size !== raw.byteLength) {
      throw new ConnectorFailure('Object-store confirmation did not match the requested capture.', {
        failureType: 'internal_failure', safeDetailCode: 'R2_CAPTURE_CONFIRMATION_MISMATCH',
        targetClass: compiledRequest.targetClass, retryClass: 'transient',
      });
    }
    await this.crashInjector?.('after_object_write_before_reference_commit', { r2Key, rawSha256 });
    const now = this.clock().toISOString();
    const retainedHeaders = safeHeaders(headers);
    // Content identity belongs to the R2 key; capture-reference identity belongs
    // to one observed fetch. A later-clock refetch after a page-commit crash may
    // reuse the object but must preserve a distinct observation without an ID
    // conflict against the already committed reference.
    const captureRefId = deterministicId('capture', {
      source: descriptor.source_id, runId, rawSha256, locator: redactedLocator(finalUrl),
      observedAt, recordedAt: now,
    });
    const reference = {
      contract_version: 'ingestion.v1.0.0',
      capture_ref_id: captureRefId,
      source_id: descriptor.source_id,
      run_id: runId,
      classification,
      source_locator: {
        endpoint_id: compiledRequest.endpoint.endpoint_id,
        template_id: compiledRequest.route.template_id,
        final_host: new URL(finalUrl).hostname,
        final_path_class: compiledRequest.targetClass,
        redacted_locator: redactedLocator(finalUrl),
      },
      safe_response_headers: retainedHeaders,
      media_type: mediaType,
      compressed_bytes: wire.byteLength,
      decompressed_bytes: body.byteLength,
      raw_sha256: rawSha256,
      semantic_sha256: semanticHash,
      r2_key: r2Key,
      r2_conditional_write_confirmed: true,
      connector_version: descriptor.connector_version,
      evidence_ref_id: deterministicId('evidence', { captureRefId, semanticHash }),
      clocks: {
        data_coverage: { state: 'unknown', start: null, end: null, semantics: 'unknown' },
        publisher_time: {
          state: retainedHeaders.last_modified ? 'known' : 'unknown',
          released_at: null,
          modified_at: retainedHeaders.last_modified ? new Date(retainedHeaders.last_modified).toISOString() : null,
        },
        observed_at: observedAt,
        recorded_at: now,
        superseded_at: null,
      },
      captured_at: observedAt,
    };
    const committed = await this.referenceStore.commit(reference);
    if (canonicalJson(committed) !== canonicalJson(reference)) {
      throw new ConnectorFailure('Capture reference commit was not idempotently confirmed.', {
        failureType: 'internal_failure', safeDetailCode: 'CAPTURE_REFERENCE_COMMIT_MISMATCH',
        targetClass: compiledRequest.targetClass, retryClass: 'transient',
      });
    }
    return reference;
  }
}
