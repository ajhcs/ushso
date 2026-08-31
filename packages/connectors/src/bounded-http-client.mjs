import { deterministicId, asBytes } from './canonical.mjs';
import { classifyResponse, mediaTypeFromHeaders } from './content-classifier.mjs';
import { ConnectorFailure, failureRecord } from './errors.mjs';
import { assertConnectedAddress, assertNoDnsRebinding, assertPublicAddressSet } from './network-policy.mjs';
import { compileManifestRequest, matchManifestRedirect, redactedLocator } from './route-manifest.mjs';

const TRANSIENT_NETWORK_CODES = new Map([
  ['ETIMEDOUT', ['timeout', 'UPSTREAM_TIMEOUT']],
  ['ABORT_ERR', ['timeout', 'UPSTREAM_TIMEOUT']],
  ['ENOTFOUND', ['dns_failure', 'UPSTREAM_DNS_FAILURE']],
  ['EAI_AGAIN', ['dns_failure', 'UPSTREAM_DNS_FAILURE']],
  ['CERT_HAS_EXPIRED', ['tls_failure', 'UPSTREAM_TLS_FAILURE']],
  ['ERR_TLS_CERT_ALTNAME_INVALID', ['tls_failure', 'UPSTREAM_TLS_FAILURE']],
]);
const UNSAFE_VALIDATOR_VALUE = /https?:\\?\/\\?\/|(?:x-amz|x-goog)-(?:credential|signature)|awsaccesskeyid|googleaccessid|access[_-]?token|api[_-]?key|\bbearer\b|-----BEGIN/i;

function makeHeaders(value) {
  if (value instanceof Headers) return new Headers(value);
  return new Headers(value ?? {});
}

function iso(clock) {
  return clock().toISOString();
}

function contentLength(headers) {
  const raw = headers.get('content-length');
  if (raw === null) return { present: false, valid: true, value: null };
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return { present: true, valid: false, value: null };
  const parsed = Number(raw);
  return { present: true, valid: Number.isSafeInteger(parsed), value: Number.isSafeInteger(parsed) ? parsed : null };
}

function validHttpDate(value) {
  if (typeof value !== 'string' || !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function validateRequestValidators(validators, targetClass) {
  if (validators == null) return;
  if (typeof validators !== 'object' || Array.isArray(validators) || Object.keys(validators).some((key) => !['etag', 'lastModified'].includes(key))) {
    throw new ConnectorFailure('Conditional request validators are malformed.', {
      failureType: 'policy_blocked', safeDetailCode: 'REQUEST_VALIDATORS_INVALID',
      targetClass, retryClass: 'pause_source', beforeEgress: true,
    });
  }
  if (validators.etag != null && (typeof validators.etag !== 'string' || validators.etag.length < 1 || validators.etag.length > 512 || /[\r\n]/.test(validators.etag) || UNSAFE_VALIDATOR_VALUE.test(validators.etag))) {
    throw new ConnectorFailure('Conditional ETag is malformed.', {
      failureType: 'policy_blocked', safeDetailCode: 'REQUEST_ETAG_INVALID',
      targetClass, retryClass: 'pause_source', beforeEgress: true,
    });
  }
  if (validators.lastModified != null && !validHttpDate(validators.lastModified)) {
    throw new ConnectorFailure('Conditional Last-Modified is malformed.', {
      failureType: 'policy_blocked', safeDetailCode: 'REQUEST_LAST_MODIFIED_INVALID',
      targetClass, retryClass: 'pause_source', beforeEgress: true,
    });
  }
}

function classifyStatus(status, targetClass, observedAt) {
  const exact = targetClass === 'exact_item' || targetClass === 'exact_distribution';
  if (status === 429) return {
    failure_type: 'rate_limited', retry_class: 'transient', target_class: targetClass,
    safe_detail_code: 'UPSTREAM_RATE_LIMITED', http_status: status, observed_at: observedAt,
  };
  if (status >= 500) return {
    failure_type: 'upstream_5xx', retry_class: 'transient', target_class: targetClass,
    safe_detail_code: 'UPSTREAM_SERVER_ERROR', http_status: status, observed_at: observedAt,
  };
  if (status === 401 || status === 403) return {
    failure_type: exact ? 'expected_access_restriction' : 'catalog_auth_misconfigured',
    retry_class: exact ? 'terminal_observation' : 'pause_source', target_class: targetClass,
    safe_detail_code: exact ? 'EXPECTED_SOURCE_ACCESS_RESTRICTION' : 'CATALOG_AUTH_MISCONFIGURED',
    http_status: status, observed_at: observedAt,
  };
  if (status === 410 && targetClass === 'pagination_cursor') return {
    failure_type: 'cursor_expired', retry_class: 'enumeration_terminal', target_class: targetClass,
    safe_detail_code: 'PAGINATION_CURSOR_EXPIRED', http_status: status, observed_at: observedAt,
  };
  if (status === 404 || status === 410) return {
    failure_type: status === 404 ? 'not_found' : 'gone',
    retry_class: exact ? 'terminal_observation' : 'enumeration_terminal', target_class: targetClass,
    safe_detail_code: exact ? 'EXACT_TARGET_ABSENT' : 'ENUMERATION_TARGET_ABSENT',
    http_status: status, observed_at: observedAt,
  };
  return {
    failure_type: 'policy_blocked', retry_class: 'quarantine', target_class: targetClass,
    safe_detail_code: 'UNEXPECTED_HTTP_STATUS', http_status: status, observed_at: observedAt,
  };
}

function networkFailure(error, targetClass, observedAt) {
  const [failureType, detail] = TRANSIENT_NETWORK_CODES.get(error?.code) ?? ['internal_failure', 'TRANSPORT_INTERNAL_FAILURE'];
  return {
    failure_type: failureType, retry_class: 'transient', target_class: targetClass,
    safe_detail_code: detail, http_status: null, observed_at: observedAt,
  };
}

function metadataFetchBase(context, compiled, observedAt) {
  return {
    contract_version: 'ingestion.v1.0.0',
    fetch_id: deterministicId('fetch', {
      runId: context.runId, jobId: context.jobId, url: redactedLocator(compiled.url), observedAt,
    }),
    run_id: context.runId,
    job_id: context.jobId,
    endpoint_id: compiled.endpoint.endpoint_id,
    template_id: compiled.route.template_id,
    purpose: compiled.purpose,
    target_class: compiled.targetClass,
    request_validators: {
      etag: context.validators?.etag ?? null,
      last_modified: context.validators?.lastModified ?? null,
    },
  };
}

export class BoundedHttpClient {
  constructor({
    transport,
    resolver,
    captureProtocol,
    requestLedger,
    governor,
    credentialProvider = null,
    clock = () => new Date(),
    requestTimeoutMs = 30_000,
  }) {
    if (!transport?.send || !resolver?.resolve || !captureProtocol?.capture || !requestLedger?.append || !governor?.acquire) {
      throw new TypeError('Injected transport, DNS resolver, capture protocol, request ledger, and origin governor are required.');
    }
    this.transport = transport;
    this.resolver = resolver;
    this.captureProtocol = captureProtocol;
    this.requestLedger = requestLedger;
    this.governor = governor;
    this.credentialProvider = credentialProvider;
    this.clock = clock;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async execute(context) {
    let compiled;
    try {
      compiled = compileManifestRequest(context.descriptor, context.request);
      validateRequestValidators(context.validators, compiled.targetClass);
      if (context.descriptor.credential_secret_locator && !this.credentialProvider?.headersFor) {
        throw new ConnectorFailure('The descriptor requires an injected credential provider.', {
          failureType: 'catalog_auth_misconfigured', safeDetailCode: 'CREDENTIAL_PROVIDER_REQUIRED',
          targetClass: compiled.targetClass, retryClass: 'pause_source', beforeEgress: true,
        });
      }
    } catch (error) {
      const observedAt = iso(this.clock);
      const failure = failureRecord(error, observedAt);
      await this.requestLedger.append({
        request_id: deterministicId('request', { source: context.descriptor?.source_id, runId: context.runId, jobId: context.jobId, request: context.request, observedAt }),
        source_id: context.descriptor?.source_id ?? 'source_unknown', endpoint_id: context.request?.endpointId ?? null,
        template_id: context.request?.templateId ?? null, purpose: context.request?.purpose ?? null,
        method: context.request?.method ?? null, target_class: context.request?.targetClass ?? failure.target_class,
        redacted_locator: null, final_host: null, final_path_class: null, egress_performed: false,
        compressed_bytes: 0, decompressed_bytes: 0, capture_classification: null,
        outcome: 'blocked_before_egress', failure_type: failure.failure_type,
        safe_detail_code: failure.safe_detail_code, observed_at: observedAt,
      });
      return { outcome: 'typed_failure', failure, capture: null, bodyBytes: null, metadataFetch: null, blockedBeforeEgress: true };
    }

    const initialCompiled = compiled;
    let currentUrl = compiled.url;
    let redirects = 0;
    let totalCompressedBytes = 0;
    let totalDecompressedBytes = 0;
    const startedAt = this.clock().getTime();

    while (true) {
      const observedAt = iso(this.clock);
      const requestId = deterministicId('request', { source: context.descriptor.source_id, runId: context.runId, jobId: context.jobId, url: redactedLocator(currentUrl), redirects, observedAt });
      let lease;
      let approvedAddresses;
      let response;
      let transportInvoked = false;
      try {
        lease = await this.governor.acquire(currentUrl.origin, context.descriptor.origin_policy, compiled.targetClass);
        approvedAddresses = assertPublicAddressSet(await this.resolver.resolve(currentUrl.hostname), compiled.targetClass);
        const requestHeaders = new Headers({ accept: context.accept ?? '*/*' });
        // Validators are scoped to the initially requested representation. A
        // redirect destination must never receive opaque source validators.
        if (redirects === 0 && context.validators?.etag) requestHeaders.set('if-none-match', context.validators.etag);
        if (redirects === 0 && context.validators?.lastModified) requestHeaders.set('if-modified-since', context.validators.lastModified);
        // Redirect hops receive a newly constructed header set and never receive
        // credentials, even when the destination remains on the initial host.
        if (context.descriptor.credential_secret_locator && redirects === 0 && currentUrl.hostname === initialCompiled.url.hostname) {
          let credential;
          try {
            credential = await this.credentialProvider.headersFor(context.descriptor.credential_secret_locator, {
              sourceId: context.descriptor.source_id,
              host: currentUrl.hostname,
              initialHost: initialCompiled.url.hostname,
            });
          } catch (error) {
            if (error instanceof ConnectorFailure) throw error;
            throw new ConnectorFailure('Credential resolution failed.', {
              failureType: 'catalog_auth_misconfigured', safeDetailCode: 'CREDENTIAL_RESOLUTION_FAILED',
              targetClass: compiled.targetClass, retryClass: 'pause_source', beforeEgress: true,
            });
          }
          const credentialHeaders = Object.entries(credential ?? {});
          if (credentialHeaders.length === 0) {
            throw new ConnectorFailure('Credential resolution returned no headers.', {
              failureType: 'catalog_auth_misconfigured', safeDetailCode: 'CREDENTIAL_HEADERS_MISSING',
              targetClass: compiled.targetClass, retryClass: 'pause_source', beforeEgress: true,
            });
          }
          for (const [name, value] of credentialHeaders) {
            if (!['authorization', 'x-api-key'].includes(name.toLowerCase()) || typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
              throw new ConnectorFailure('Credential provider emitted an invalid or unapproved header.', {
                failureType: 'catalog_auth_misconfigured', safeDetailCode: 'CREDENTIAL_HEADER_REJECTED',
                targetClass: compiled.targetClass, retryClass: 'pause_source', beforeEgress: true,
              });
            }
            requestHeaders.set(name, value);
          }
        }
        transportInvoked = true;
        response = await this.transport.send({
          url: currentUrl.toString(), method: compiled.method, headers: requestHeaders,
          redirect: 'manual', approvedAddresses: [...approvedAddresses],
          timeoutMs: Math.min(this.requestTimeoutMs, context.descriptor.bounds.maximum_run_seconds * 1000),
          maximumCompressedBytes: context.descriptor.bounds.maximum_response_bytes,
          maximumDecompressedBytes: context.descriptor.bounds.maximum_decompressed_bytes,
        });
        response.headers = makeHeaders(response.headers);
        assertConnectedAddress(response.connectedAddress, approvedAddresses, compiled.targetClass);
        const rechecked = assertPublicAddressSet(await this.resolver.resolve(currentUrl.hostname), compiled.targetClass);
        assertNoDnsRebinding(approvedAddresses, rechecked, compiled.targetClass);
      } catch (error) {
        const failure = error instanceof ConnectorFailure ? failureRecord(error, observedAt) : networkFailure(error, compiled.targetClass, observedAt);
        lease?.release({ success: false, consumeFailureBudget: ['rate_limited', 'upstream_5xx', 'timeout', 'dns_failure', 'tls_failure', 'internal_failure'].includes(failure.failure_type) });
        await this.requestLedger.append({
          request_id: requestId, source_id: context.descriptor.source_id,
          endpoint_id: compiled.endpoint.endpoint_id, template_id: compiled.route.template_id,
          purpose: compiled.purpose, method: compiled.method, target_class: compiled.targetClass,
          redacted_locator: redactedLocator(currentUrl), final_host: currentUrl.hostname,
          final_path_class: compiled.targetClass, egress_performed: transportInvoked,
          compressed_bytes: 0, decompressed_bytes: 0, capture_classification: null,
          outcome: transportInvoked ? 'typed_failure' : 'blocked_before_egress',
          failure_type: failure.failure_type, safe_detail_code: failure.safe_detail_code, observed_at: observedAt,
        });
        return { outcome: 'typed_failure', failure, capture: null, bodyBytes: null, metadataFetch: null, blockedBeforeEgress: !transportInvoked };
      }

      const status = response.status;
      const wireBytes = asBytes(response.wireBytes ?? response.bodyBytes ?? new Uint8Array());
      const bodyBytes = asBytes(response.bodyBytes ?? response.wireBytes ?? new Uint8Array());
      totalCompressedBytes += wireBytes.byteLength;
      totalDecompressedBytes += bodyBytes.byteLength;
      const elapsed = this.clock().getTime() - startedAt;
      const declaredLength = contentLength(response.headers);
      if (!declaredLength.valid) {
        lease.release({ success: false, consumeFailureBudget: false });
        return this.#quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, totalCompressedBytes, totalDecompressedBytes, 'canonical_invariant_failure', 'CONTENT_LENGTH_INVALID', status);
      }
      if (declaredLength.value !== null && declaredLength.value > context.descriptor.bounds.maximum_response_bytes) {
        lease.release({ success: false, consumeFailureBudget: false });
        return this.#quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, totalCompressedBytes, totalDecompressedBytes, 'response_too_large', 'DECLARED_RESPONSE_TOO_LARGE', status);
      }
      if (declaredLength.value !== null && declaredLength.value !== wireBytes.byteLength) {
        lease.release({ success: false, consumeFailureBudget: false });
        return this.#quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, totalCompressedBytes, totalDecompressedBytes, 'canonical_invariant_failure', 'CONTENT_LENGTH_MISMATCH', status);
      }
      const contentEncoding = (response.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
      if (!['identity', 'gzip', 'br', 'deflate'].includes(contentEncoding)) {
        lease.release({ success: false, consumeFailureBudget: false });
        return this.#quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, totalCompressedBytes, totalDecompressedBytes, 'unexpected_content_type', 'CONTENT_ENCODING_UNSUPPORTED', status);
      }
      if (totalCompressedBytes > context.descriptor.bounds.maximum_response_bytes || totalDecompressedBytes > context.descriptor.bounds.maximum_decompressed_bytes || elapsed > context.descriptor.bounds.maximum_run_seconds * 1000) {
        lease.release({ success: false, consumeFailureBudget: false });
        return this.#quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, totalCompressedBytes, totalDecompressedBytes, 'response_too_large', elapsed > context.descriptor.bounds.maximum_run_seconds * 1000 ? 'REQUEST_DURATION_BOUND_EXCEEDED' : 'RESPONSE_SIZE_BOUND_EXCEEDED', status);
      }

      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.get('location');
        try {
          if (!location) throw new ConnectorFailure('Redirect omitted Location.', { failureType: 'redirect_unapproved', safeDetailCode: 'REDIRECT_LOCATION_MISSING', targetClass: compiled.targetClass, retryClass: 'quarantine', quarantine: true });
          if (context.descriptor.redirect_policy === 'deny') throw new ConnectorFailure('Redirects are disabled.', { failureType: 'redirect_unapproved', safeDetailCode: 'REDIRECT_POLICY_DENY', targetClass: compiled.targetClass, retryClass: 'quarantine', quarantine: true });
          if (redirects >= context.descriptor.bounds.maximum_redirects) throw new ConnectorFailure('Redirect bound exceeded.', { failureType: 'redirect_unapproved', safeDetailCode: 'REDIRECT_BOUND_EXCEEDED', targetClass: compiled.targetClass, retryClass: 'quarantine', quarantine: true });
          const candidate = new URL(location, currentUrl);
          if (context.descriptor.redirect_policy === 'same_origin' && candidate.origin !== currentUrl.origin) throw new ConnectorFailure('Cross-origin redirect is disabled.', { failureType: 'redirect_unapproved', safeDetailCode: 'CROSS_ORIGIN_REDIRECT_BLOCKED', targetClass: compiled.targetClass, retryClass: 'quarantine', quarantine: true });
          const redirectFrom = compiled;
          const redirectTo = matchManifestRedirect(context.descriptor, candidate, compiled);
          await this.requestLedger.append({
            request_id: requestId, source_id: context.descriptor.source_id,
            endpoint_id: redirectFrom.endpoint.endpoint_id, template_id: redirectFrom.route.template_id,
            purpose: redirectFrom.purpose, method: redirectFrom.method, target_class: redirectFrom.targetClass,
            redacted_locator: redactedLocator(currentUrl), final_host: currentUrl.hostname,
            final_path_class: redirectFrom.targetClass, egress_performed: true,
            compressed_bytes: wireBytes.byteLength, decompressed_bytes: bodyBytes.byteLength,
            capture_classification: null, outcome: 'approved_redirect', failure_type: null,
            safe_detail_code: null, observed_at: observedAt,
          });
          lease.release({ success: true });
          compiled = redirectTo;
          currentUrl = candidate;
          redirects += 1;
          continue;
        } catch (error) {
          lease.release({ success: false, consumeFailureBudget: false });
          const failure = failureRecord(error, observedAt);
          await this.requestLedger.append({
            request_id: requestId, source_id: context.descriptor.source_id,
            endpoint_id: compiled.endpoint.endpoint_id, template_id: compiled.route.template_id,
            purpose: compiled.purpose, method: compiled.method, target_class: compiled.targetClass,
            redacted_locator: redactedLocator(currentUrl), final_host: currentUrl.hostname,
            final_path_class: compiled.targetClass, egress_performed: true,
            compressed_bytes: wireBytes.byteLength, decompressed_bytes: bodyBytes.byteLength,
            capture_classification: 'redirect_quarantined', outcome: 'quarantined',
            failure_type: failure.failure_type, safe_detail_code: failure.safe_detail_code, observed_at: observedAt,
          });
          return { outcome: 'typed_failure', failure, capture: null, bodyBytes: null, metadataFetch: null, blockedBeforeEgress: false };
        }
      }

      if (status === 304) {
        const hasValidator = Boolean(context.validators?.etag || context.validators?.lastModified);
        if (redirects !== 0 || !hasValidator || !context.priorCaptureRefId || wireBytes.byteLength !== 0 || bodyBytes.byteLength !== 0) {
          lease.release({ success: false, consumeFailureBudget: false });
          return this.#quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, totalCompressedBytes, totalDecompressedBytes, 'canonical_invariant_failure', 'INVALID_NOT_MODIFIED_RESPONSE', status);
        }
        const metadataFetch = {
          ...metadataFetchBase(context, initialCompiled, observedAt), response_status: 304,
          outcome: 'not_modified', capture_ref_id: null, reused_capture_ref_id: context.priorCaptureRefId,
          failure: null, response_bytes: 0, decompressed_bytes: 0, redirect_count: redirects, observed_at: observedAt,
        };
        await this.#appendSuccessLedger(context, compiled, currentUrl, requestId, observedAt, 0, 0, null, 'not_modified');
        lease.release({ success: true });
        return { outcome: 'not_modified', failure: null, capture: null, bodyBytes: null, metadataFetch, blockedBeforeEgress: false };
      }

      if (status !== 200 && status !== 204) {
        const failure = classifyStatus(status, compiled.targetClass, observedAt);
        await this.requestLedger.append({
          request_id: requestId, source_id: context.descriptor.source_id,
          endpoint_id: compiled.endpoint.endpoint_id, template_id: compiled.route.template_id,
          purpose: compiled.purpose, method: compiled.method, target_class: compiled.targetClass,
          redacted_locator: redactedLocator(currentUrl), final_host: currentUrl.hostname,
          final_path_class: compiled.targetClass, egress_performed: true,
          compressed_bytes: wireBytes.byteLength, decompressed_bytes: bodyBytes.byteLength,
          capture_classification: null, outcome: 'typed_failure', failure_type: failure.failure_type,
          safe_detail_code: failure.safe_detail_code, observed_at: observedAt,
        });
        lease.release({ success: false, consumeFailureBudget: ['rate_limited', 'upstream_5xx'].includes(failure.failure_type) });
        const metadataFetch = {
          ...metadataFetchBase(context, initialCompiled, observedAt), response_status: status,
          outcome: 'typed_failure', capture_ref_id: null, reused_capture_ref_id: null, failure,
          response_bytes: wireBytes.byteLength, decompressed_bytes: bodyBytes.byteLength,
          redirect_count: redirects, observed_at: observedAt,
        };
        return { outcome: 'typed_failure', failure, capture: null, bodyBytes: null, metadataFetch, blockedBeforeEgress: false };
      }

      if (compiled.method === 'HEAD' || compiled.purpose === 'access_probe') {
        if (wireBytes.byteLength !== 0 || bodyBytes.byteLength !== 0) {
          lease.release({ success: false, consumeFailureBudget: false });
          return this.#quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, totalCompressedBytes, totalDecompressedBytes, 'policy_blocked', 'ACCESS_PROBE_BODY_BLOCKED', status);
        }
        await this.#appendSuccessLedger(context, compiled, currentUrl, requestId, observedAt, 0, 0, 'access_status_headers', 'access_observed');
        lease.release({ success: true });
        return {
          outcome: 'access_observed', failure: null, capture: null, bodyBytes: null,
          accessObservation: { status, mediaType: mediaTypeFromHeaders(response.headers), observedAt },
          metadataFetch: null, blockedBeforeEgress: false,
        };
      }

      const classification = classifyResponse({
        purpose: compiled.purpose,
        expectedContentClasses: compiled.route.expected_content_classes,
        headers: response.headers,
        bodyBytes,
        profile: context.responseProfile,
      });
      if (!classification.accepted) {
        lease.release({ success: false, consumeFailureBudget: false });
        const failureType = classification.reasonCode === 'UNEXPECTED_CONTENT_TYPE' || classification.reasonCode.startsWith('MISLEADING') ? 'unexpected_content_type' : classification.reasonCode.includes('PARSE') ? 'parse_failure' : 'policy_blocked';
        return this.#quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, totalCompressedBytes, totalDecompressedBytes, failureType, classification.reasonCode, status, classification.classification);
      }
      try {
        const capture = await this.captureProtocol.capture({
          descriptor: context.descriptor, runId: context.runId, compiledRequest: compiled,
          finalUrl: currentUrl, headers: response.headers, wireBytes, bodyBytes, observedAt,
        });
        await this.#appendSuccessLedger(context, compiled, currentUrl, requestId, observedAt, wireBytes.byteLength, bodyBytes.byteLength, classification.classification, 'captured');
        lease.release({ success: true });
        const metadataFetch = {
          ...metadataFetchBase(context, initialCompiled, observedAt), response_status: status,
          outcome: 'captured', capture_ref_id: capture.capture_ref_id, reused_capture_ref_id: null,
          failure: null, response_bytes: wireBytes.byteLength, decompressed_bytes: bodyBytes.byteLength,
          redirect_count: redirects, observed_at: observedAt,
        };
        return { outcome: 'captured', failure: null, capture, bodyBytes, parsed: classification.parsed, metadataFetch, blockedBeforeEgress: false };
      } catch (error) {
        lease.release({ success: false, consumeFailureBudget: true });
        const failure = failureRecord(error, observedAt);
        await this.requestLedger.append({
          request_id: requestId, source_id: context.descriptor.source_id,
          endpoint_id: compiled.endpoint.endpoint_id, template_id: compiled.route.template_id,
          purpose: compiled.purpose, method: compiled.method, target_class: compiled.targetClass,
          redacted_locator: redactedLocator(currentUrl), final_host: currentUrl.hostname,
          final_path_class: compiled.targetClass, egress_performed: true,
          compressed_bytes: wireBytes.byteLength, decompressed_bytes: bodyBytes.byteLength,
          capture_classification: classification.classification, outcome: 'capture_failed',
          failure_type: failure.failure_type, safe_detail_code: failure.safe_detail_code, observed_at: observedAt,
        });
        return { outcome: 'typed_failure', failure, capture: null, bodyBytes: null, metadataFetch: null, blockedBeforeEgress: false };
      }
    }
  }

  async #quarantine(context, compiled, initialCompiled, currentUrl, requestId, observedAt, redirects, compressedBytes, decompressedBytes, failureType, detailCode, status, classification = null) {
    const failure = {
      failure_type: failureType, retry_class: 'quarantine', target_class: compiled.targetClass,
      safe_detail_code: detailCode, http_status: status, observed_at: observedAt,
    };
    await this.requestLedger.append({
      request_id: requestId, source_id: context.descriptor.source_id,
      endpoint_id: compiled.endpoint.endpoint_id, template_id: compiled.route.template_id,
      purpose: compiled.purpose, method: compiled.method, target_class: compiled.targetClass,
      redacted_locator: redactedLocator(currentUrl), final_host: currentUrl.hostname,
      final_path_class: compiled.targetClass, egress_performed: true,
      compressed_bytes: compressedBytes, decompressed_bytes: decompressedBytes,
      capture_classification: classification, outcome: 'quarantined', failure_type: failure.failure_type,
      safe_detail_code: detailCode, observed_at: observedAt,
    });
    const metadataFetch = {
      ...metadataFetchBase(context, initialCompiled, observedAt), response_status: status,
      outcome: 'typed_failure', capture_ref_id: null, reused_capture_ref_id: null, failure,
      response_bytes: Math.min(compressedBytes, 52_428_800),
      decompressed_bytes: Math.min(decompressedBytes, 104_857_600),
      redirect_count: redirects, observed_at: observedAt,
    };
    return { outcome: 'typed_failure', failure, capture: null, bodyBytes: null, metadataFetch, blockedBeforeEgress: false, quarantined: true };
  }

  async #appendSuccessLedger(context, compiled, currentUrl, requestId, observedAt, compressedBytes, decompressedBytes, classification, outcome) {
    await this.requestLedger.append({
      request_id: requestId, source_id: context.descriptor.source_id,
      endpoint_id: compiled.endpoint.endpoint_id, template_id: compiled.route.template_id,
      purpose: compiled.purpose, method: compiled.method, target_class: compiled.targetClass,
      redacted_locator: redactedLocator(currentUrl), final_host: currentUrl.hostname,
      final_path_class: compiled.targetClass, egress_performed: true,
      compressed_bytes: compressedBytes, decompressed_bytes: decompressedBytes,
      capture_classification: classification, outcome, failure_type: null,
      safe_detail_code: null, observed_at: observedAt,
    });
  }
}
