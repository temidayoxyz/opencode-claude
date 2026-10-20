import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessagesRequest } from '../src/gateway/messages.ts';

const request = (patch = {}) => ({
  model: 'claude-sonnet-4-6-oc-test', max_tokens: 100,
  messages: [{ role: 'user', content: 'Hello' }], ...patch,
});

test('messages-text preserves system instructions and ordered conversation text', () => {
  const result = parseMessagesRequest(request({
    system: [{ type: 'text', text: 'Be concise', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Reply' },
      { role: 'user', content: [{ type: 'text', text: 'Next' }] }],
  }));
  assert.deepEqual(result.system, [{ type: 'text', text: 'Be concise' }]);
  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'assistant', 'user']);
  assert.equal(result.messages[2].content[0].text, 'Next');
  assert.equal(result.stream, false);
});

test('messages-text carries tool use and results with their original IDs', () => {
  const result = parseMessagesRequest(request({
    tools: [{ name: 'Counter', description: 'Count', input_schema: { type: 'object' } }],
    messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'Counter', input: { delta: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"value":1}' },
        { type: 'text', text: 'Continue' }] }],
  }));
  assert.deepEqual(result.messages[1], { role: 'tool', content: [{
    type: 'tool-result', id: 'call_1', name: 'Counter', result: { type: 'text', value: '{"value":1}' },
  }] });
  assert.equal(result.messages[2].role, 'user');
  assert.equal(result.tools[0].name, 'Counter');
});

test('messages-text rejects unsupported content instead of dropping it', () => {
  for (const type of ['image', 'document', 'thinking', 'server_tool_use']) {
    assert.throws(() => parseMessagesRequest(request({
      messages: [{ role: 'user', content: [{ type }] }],
    })), /unsupported/i);
  }
});

test('messages-text rejects invalid tokens, roles, tool results, and duplicate tools', () => {
  const invalid = [
    { max_tokens: -1 }, { max_tokens: 1.5 }, { stream: 'yes' },
    { messages: [{ role: 'system', content: 'Wrong channel' }] },
    { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'x' }] }] },
    { tools: [{ name: 'A', input_schema: {} }, { name: 'A', input_schema: {} }] },
    { tool_choice: { type: 'auto', disable_parallel_tool_use: true } },
    { tools: [{ name: 'A', input_schema: {}, defer_loading: true }] },
  ];
  for (const patch of invalid) assert.throws(() => parseMessagesRequest(request(patch)));
});
