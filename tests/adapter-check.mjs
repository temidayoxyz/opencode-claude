import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { createAdapter } from '../dist/opencode/adapter.js';

const fixture = await createFixture();
let adapter;
try {
  adapter = await createAdapter({
    stateRoot: fileURLToPath(new URL('../.runtime/', import.meta.url)), isolated: true,
    providers: { fixture: {
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
      models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } },
    } },
  });
  const target = { providerID: 'fixture', id: 'probe' };
  const base = { model: 'claude-sonnet-4-6-oc-test', max_tokens: 100,
    system: 'Test caller instructions', tools: [{ name: 'external_counter', input_schema: {
      type: 'object', properties: { delta: { type: 'integer' } }, required: ['delta'],
    } }] };
  const first = [];
  await adapter.generate({ ...base, messages: [{ role: 'user', content: 'Use the counter' }] },
    target, async (frame) => { first.push(frame); });
  const call = first.flatMap((frame) => frame.choices?.[0]?.delta?.tool_calls ?? [])[0];
  assert.equal(call.function.name, 'external_counter');
  assert.equal(JSON.parse(call.function.arguments).delta, 1);
  const second = [];
  await adapter.generate({ ...base, messages: [
    { role: 'user', content: 'Use the counter' },
    { role: 'assistant', content: [{ type: 'tool_use', id: call.id, name: call.function.name, input: { delta: 1 } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: '{"value":1}' }] },
  ] }, target, async (frame) => { second.push(frame); });
  assert.match(second.map((frame) => frame.choices?.[0]?.delta?.content ?? '').join(''), /EXTERNAL_COUNTER=1/);
  assert.equal((await fixture.status()).calls.length, 0, 'The native generation adapter must execute no tool');
  // The 33rd generation crosses the native location-cache lifetime boundary.
  for (let index = 0; index < 31; index++) {
    const frames = [];
    await adapter.generate({ model: base.model, max_tokens: 20, messages: [{ role: 'user', content: `Isolated ${index}` }] },
      target, async frame => { frames.push(frame); });
    assert.match(JSON.stringify(frames), /Fixture title/);
  }
} finally {
  await adapter?.close();
  await fixture.close();
}
console.log('Real OpenCode Messages adapter tool/result check PASS; no Claude client or hosted model tested');
