import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { createAdapter } from '../dist/opencode/adapter.js';
const fixture = await createFixture({ status: 403 });
let adapter;
try {
  adapter = await createAdapter({ stateRoot: fileURLToPath(new URL('../.runtime/', import.meta.url)), isolated: true,
    providers: { fixture: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
      models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } } } } });
  await assert.rejects(adapter.generate({ model: 'alias', max_tokens: 32, messages: [{ role: 'user', content: 'Hello' }] },
    { providerID: 'fixture', id: 'probe' }, async () => {}), error => /Provider returned 403/.test(error.message) && !error.message.includes('PRIVATE_PROVIDER_BODY'));
  assert.equal((await fixture.status()).modelRequests, 1);
} finally { await adapter?.close(); await fixture.close(); }
console.log('PASS: real OpenCode preserves provider HTTP status without exposing the response body or retrying a denial');
