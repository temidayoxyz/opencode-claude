import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageStream } from '../src/gateway/stream.ts';

test('messages-stream: text and actual usage produce ordered native events', async () => {
  const events = [];
  const stream = new MessageStream('alias', [], async (type, data) => events.push({ type, data }));
  await stream.frame({ choices: [{ delta: { content: 'Hello 🌍' }, finish_reason: null }] });
  await stream.frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
  const result = await stream.finish();
  assert.equal(result.content[0].text, 'Hello 🌍');
  assert.equal(result.usage.input_tokens, 12);
  assert.equal(result.usage.output_tokens, 3);
  assert.deepEqual(events.map(e => e.type), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
});

test('messages-tools: fragmented parallel arguments retain IDs and inputs', async () => {
  const events = [];
  const stream = new MessageStream('alias', ['Read'], async (type, data) => events.push({ type, data }));
  await stream.frame({ choices: [{ delta: { tool_calls: [
    { index: 0, id: 'call_a', function: { name: 'Read', arguments: '{"path":' } },
    { index: 1, id: 'call_b', function: { name: 'Read', arguments: '{"path":"b"}' } },
  ] } }] });
  await stream.frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, finish_reason: 'tool_calls' }] });
  const result = await stream.finish();
  assert.equal(result.stop_reason, 'tool_use');
  assert.deepEqual(result.content.map(b => [b.id, b.input]), [['call_a', { path: 'a' }], ['call_b', { path: 'b' }]]);
  assert.equal(events.filter(e => e.type === 'content_block_stop').length, 2);
  assert.deepEqual(events.filter(e => e.type.includes('content_block')).map(e => [e.type, e.data.index]), [
    ['content_block_start', 0], ['content_block_delta', 0], ['content_block_stop', 0],
    ['content_block_start', 1], ['content_block_delta', 1], ['content_block_stop', 1],
  ]);
});

test('messages-stream: malformed, unknown tools and incomplete generations fail', async () => {
  const malformed = new MessageStream('alias', ['Read']);
  await malformed.frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'Read', arguments: '{' } }] }, finish_reason: 'tool_calls' }] });
  await assert.rejects(malformed.finish(), /arguments/);
  const unknown = new MessageStream('alias', []);
  await assert.rejects(unknown.frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'Delete', arguments: '{}' } }] } }] }), /tool/);
  const truncated = new MessageStream('alias', []);
  await truncated.frame({ choices: [{ delta: { content: 'partial' } }] });
  await assert.rejects(truncated.finish(), /finish/);
});
