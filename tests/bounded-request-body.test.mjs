import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discardRequestBody,
  readBoundedBytes,
  readBoundedText,
  RequestBodyReadError,
  RequestBodyTooLargeError,
} from '../worker/bounded-request-body.mjs';

function requestFromStream(stream) {
  return new Request('https://ushso.test/api/discover', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  });
}

async function timed(label, operation, maximumMs) {
  const started = performance.now();
  await operation();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < maximumMs, `${label} exceeded ${maximumMs}ms: ${elapsed.toFixed(1)}ms`);
}


await test('small body drains to completion', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
    cancel() { cancelled = true; },
  });
  await discardRequestBody(requestFromStream(stream), 8, { timeoutMs: 50, cancelTimeoutMs: 10 });
  assert.equal(cancelled, false);
});

await test('over-limit body cancels after bounded bytes', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
    },
    cancel() { cancelled = true; },
  });
  await discardRequestBody(requestFromStream(stream), 4, { timeoutMs: 50, cancelTimeoutMs: 10 });
  assert.equal(cancelled, true);
});

await test('erroring body preserves early response path', async () => {
  const stream = new ReadableStream({
    pull() { throw new Error('source failed'); },
  });
  await timed('erroring body cleanup', () => discardRequestBody(requestFromStream(stream), 4, { timeoutMs: 50, cancelTimeoutMs: 10 }), 150);
});

await test('stalled body has bounded cleanup', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { cancelled = true; },
  });
  await timed('stalled body cleanup', () => discardRequestBody(requestFromStream(stream), 4, { timeoutMs: 25, cancelTimeoutMs: 15 }), 150);
  assert.equal(cancelled, true, 'cleanup attempts cancellation before returning on deadline');
});

await test('never-settling cancellation has bounded cleanup', async () => {
  const stream = new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { return new Promise(() => {}); },
  });
  await timed('never-settling cancellation', () => discardRequestBody(requestFromStream(stream), 4, { timeoutMs: 25, cancelTimeoutMs: 15 }), 150);
});

await test('cancellation failure is swallowed', async () => {
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(6)); },
    cancel() { throw new Error('cancel failed'); },
  });
  await timed('cancellation failure', () => discardRequestBody(requestFromStream(stream), 4, { timeoutMs: 50, cancelTimeoutMs: 10 }), 150);
});

await test('bounded text accepts exact byte limit', async () => {
  const response = await readBoundedText(new Request('https://ushso.test', { method: 'POST', body: '1234' }), 4);
  assert.equal(response, '1234');
});

await test('bounded text maps over-limit body', async () => {
  await assert.rejects(
    () => readBoundedBytes(new Request('https://ushso.test', { method: 'POST', body: '12345' }), 4),
    RequestBodyTooLargeError,
  );
});

await test('bounded text maps stream failure', async () => {
  const stream = new ReadableStream({ pull() { throw new Error('source failed'); } });
  await assert.rejects(
    () => readBoundedBytes(requestFromStream(stream), 32, { timeoutMs: 50, cancelTimeoutMs: 10 }),
    RequestBodyReadError,
  );
});

await test('bounded text maps stalled read', async () => {
  const stream = new ReadableStream({ pull() { return new Promise(() => {}); } });
  await assert.rejects(
    () => readBoundedBytes(requestFromStream(stream), 32, { timeoutMs: 25, cancelTimeoutMs: 10 }),
    RequestBodyReadError,
  );
});
