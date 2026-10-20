import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { createAdapter } from '../dist/opencode/adapter.js';

let entered;
const waiting = new Promise(resolve => { entered = resolve; });
let upstreamCancelled = false;
const fixture = await createFixture({ async reply(body, { signal }) {
  if (JSON.stringify(body.messages).includes('WAIT_FOR_CANCEL')) {
    entered();
    await new Promise(resolve => signal.addEventListener('abort', () => { upstreamCancelled = true; resolve(); }, { once: true }));
  }
  return { role: 'assistant', content: 'READY' };
} });
let adapter;
try {
  adapter = await createAdapter({ stateRoot: fileURLToPath(new URL('../.runtime/', import.meta.url)), isolated: true,
    providers: { fixture: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
      models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } } } } });
  const target = { providerID: 'fixture', id: 'probe' };
  const request = text => ({ model: 'alias', max_tokens: 50, messages: [{ role: 'user', content: text }] });
  const controller = new AbortController();
  const slow = adapter.generate(request('WAIT_FOR_CANCEL'), target, async () => {}, controller.signal).then(() => 'success', () => 'cancelled');
  await Promise.race([waiting, new Promise((_, reject) => setTimeout(() => reject(new Error('No slow generation')), 10000).unref())]);
  const frames = [];
  await adapter.generate(request('SEPARATE'), target, async frame => { frames.push(frame); });
  controller.abort();
  assert.equal(await slow, 'cancelled');
  assert.match(JSON.stringify(frames), /READY/);
  for (let i = 0; i < 100 && !upstreamCancelled; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(upstreamCancelled, true, 'The provider request must be cancelled, not left running');
} finally { await adapter?.close(); await fixture.close(); }
console.log('PASS: real OpenCode concurrent request isolation and provider cancellation');
