import assert from 'node:assert/strict';
import test from 'node:test';
import { readSSE } from '../src/opencode/sse.ts';

function bytes(text) {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
}
async function collect(stream, limit) {
  const result = [];
  for await (const frame of readSSE(stream, limit)) result.push(frame);
  return result;
}

test('stream-data handles split Unicode, CRLF, comments, and multiline data', async () => {
  const stream = bytes(': keepalive\r\ndata: {"text":"héllo 🌍"}\r\n\r\ndata: first\ndata: second\n\ndata: [DONE]\r\r');
  assert.deepEqual(await collect(stream), ['{"text":"héllo 🌍"}', 'first\nsecond', '[DONE]']);
});

test('stream-data rejects oversized or truncated events', async () => {
  await assert.rejects(collect(bytes('data: 123456789\n\n'), 8), /exceeds/i);
  await assert.rejects(collect(bytes('data: {"partial":true}')), /truncated/i);
});

test('stream-data cancels its source when the consumer stops', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: one\n\n')); },
    cancel() { cancelled = true; },
  });
  for await (const frame of readSSE(stream)) {
    assert.equal(frame, 'one');
    break;
  }
  assert.equal(cancelled, true);
});
