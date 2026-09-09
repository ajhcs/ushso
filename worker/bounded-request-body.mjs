const TIMED_OUT = Symbol('request-body-timeout');

export const DEFAULT_DRAIN_TIMEOUT_MS = 250;
export const DEFAULT_CANCEL_TIMEOUT_MS = 50;
export const DEFAULT_READ_TIMEOUT_MS = 10_000;

async function settleWithin(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function cancelWithin(reader, timeoutMs, reason) {
  try {
    await settleWithin(() => reader.cancel(reason), timeoutMs);
  } catch {
    // The caller is already committed to its typed validation response.
  }
}

function release(reader) {
  try {
    reader.releaseLock();
  } catch {
    // A timed out read may still own the lock. The request handler must not hang.
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor(message = 'Request body exceeds its byte limit.') {
    super(message);
    this.name = 'RequestBodyTooLargeError';
    this.code = 'body_too_large';
  }
}

export class RequestBodyReadError extends Error {
  constructor(message = 'Request body could not be read safely.', options = {}) {
    super(message);
    if (options.cause !== undefined) this.cause = options.cause;
    this.name = 'RequestBodyReadError';
    this.code = 'body_read_failed';
  }
}

/**
 * Best-effort bounded cleanup for a request that is about to return early.
 * It reads at most maxBytes plus the first over-limit chunk and never lets
 * stream or cancellation failures replace the caller's validation response.
 */
export async function discardRequestBody(request, maxBytes, {
  timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
  cancelTimeoutMs = DEFAULT_CANCEL_TIMEOUT_MS,
} = {}) {
  let reader;
  try {
    reader = request?.body?.getReader();
  } catch {
    return;
  }
  if (!reader) return;

  const deadline = performance.now() + Math.max(1, timeoutMs);
  let complete = false;
  let bytes = 0;
  try {
    while (true) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      const result = await settleWithin(() => reader.read(), remaining);
      if (result === TIMED_OUT) break;
      if (result?.done) {
        complete = true;
        break;
      }
      const chunkBytes = result?.value?.byteLength;
      if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 0) break;
      bytes += chunkBytes;
      if (bytes > maxBytes) break;
    }
  } catch {
    // Cleanup is deliberately best effort. Preserve the caller's status code.
  } finally {
    if (!complete) await cancelWithin(reader, cancelTimeoutMs, 'request body discarded');
    release(reader);
  }
}

/**
 * Read a request body into bytes with both a byte bound and a read deadline.
 * Stream errors are normalized so callers can retain their typed HTTP mapping.
 */
export async function readBoundedBytes(request, maxBytes, {
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
  cancelTimeoutMs = DEFAULT_CANCEL_TIMEOUT_MS,
} = {}) {
  let reader;
  try {
    reader = request?.body?.getReader();
  } catch (error) {
    throw new RequestBodyReadError('Request body could not be opened safely.', { cause: error });
  }
  if (!reader) return new Uint8Array();

  const chunks = [];
  let bytes = 0;
  let complete = false;
  const deadline = performance.now() + Math.max(1, timeoutMs);
  try {
    while (true) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new RequestBodyReadError('Request body read timed out.');
      const result = await settleWithin(() => reader.read(), remaining);
      if (result === TIMED_OUT) throw new RequestBodyReadError('Request body read timed out.');
      if (result?.done) {
        complete = true;
        break;
      }
      const chunk = result?.value;
      if (!(chunk instanceof Uint8Array)) throw new RequestBodyReadError('Request body was not a byte stream.');
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new RequestBodyTooLargeError();
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || error instanceof RequestBodyReadError) throw error;
    throw new RequestBodyReadError('Request body could not be read safely.', { cause: error });
  } finally {
    if (!complete) await cancelWithin(reader, cancelTimeoutMs, 'request body read failed');
    release(reader);
  }

  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function readBoundedText(request, maxBytes, options = {}) {
  let bytes;
  try {
    bytes = await readBoundedBytes(request, maxBytes, options);
  } catch (error) {
    throw error;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new RequestBodyReadError('Request body is not valid UTF-8.', { cause: error });
  }
}
