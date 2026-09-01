import { ConnectorFailure, policyFailure } from './errors.mjs';

export function assertPinnedTransportRequest(request, targetClass = 'collection') {
  if (!request || typeof request !== 'object') {
    throw policyFailure('TRANSPORT_PIN_REQUIRED', targetClass);
  }
  if (!Array.isArray(request.approvedAddresses) || request.approvedAddresses.length === 0) {
    throw policyFailure('TRANSPORT_PIN_REQUIRED', targetClass);
  }
  if (request.pinBeforeConnect !== true) {
    throw policyFailure('TRANSPORT_PIN_REQUIRED', targetClass);
  }
  if (!Number.isSafeInteger(request.maximumCompressedBytes) || request.maximumCompressedBytes < 1) {
    throw policyFailure('TRANSPORT_STREAM_LIMIT_REQUIRED', targetClass);
  }
  if (!Number.isSafeInteger(request.maximumDecompressedBytes) || request.maximumDecompressedBytes < 1) {
    throw policyFailure('TRANSPORT_STREAM_LIMIT_REQUIRED', targetClass);
  }
}

export async function readLimitedBody(stream, { maximumBytes, targetClass }) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) {
      throw new ConnectorFailure('Response exceeded the streaming size bound.', {
        failureType: 'response_too_large',
        safeDetailCode: 'RESPONSE_SIZE_BOUND_EXCEEDED',
        targetClass,
        retryClass: 'quarantine',
        quarantine: true,
      });
    }
    chunks.push(bytes);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function createPinnedStreamingTransport(innerSend) {
  if (typeof innerSend !== 'function') throw new TypeError('Pinned streaming transport requires an inner send function.');
  return {
    async send(request) {
      assertPinnedTransportRequest(request, 'collection');
      return innerSend({
        ...request,
        lookup: (hostname, options, callback) => {
          const approved = [...request.approvedAddresses];
          if (typeof callback === 'function') callback(null, approved.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
          return approved;
        },
      });
    },
  };
}
