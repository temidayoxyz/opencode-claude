import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessagesRequest } from '../dist/gateway/messages.js';

test('native sessions accept Desktop thinking preferences without changing the OpenCode model request', () => {
  const base = { model: 'alias', max_tokens: 8192, messages: [{ role: 'user', content: 'Hello' }] };
  for (const thinking of [{ type: 'adaptive' }, { type: 'enabled', budget_tokens: 2048 }, { type: 'disabled' }]) {
    const parsed = parseMessagesRequest({ ...base, thinking }, 'session');
    assert.deepEqual(parsed.options, { maxTokens: 8192 });
    assert.equal(parsed.messages[0].content[0].text, 'Hello');
  }
  assert.throws(() => parseMessagesRequest({ ...base, thinking: { type: 'adaptive' } }), /thinking/);
});


test('a native session conflict is not reported as invalid model HTTP 400', async () => {
  const { createGateway } = await import('../dist/gateway/server.js');
  const { RequestError } = await import('../dist/gateway/messages.js');
  const gateway = await createGateway({ token: 'management', mappings: { alias: { providerID: 'fixture', id: 'probe' } }, sessions: {
    async respond() { throw new RequestError('An earlier request needs inspection before retry.', 409); }, async models() { return {}; }, async close() {},
  } });
  try {
    const registration = await fetch(gateway.url + '/_clients', { method: 'POST', headers: { 'x-api-key': 'management' },
      body: JSON.stringify({ kind: 'desktop', directory: process.cwd(), model: 'fixture/probe' }) });
    const { token } = await registration.json();
    const response = await fetch(gateway.url + '/v1/messages', { method: 'POST', headers: { 'x-api-key': token },
      body: JSON.stringify({ model: 'alias', max_tokens: 32, thinking: { type: 'adaptive' }, messages: [{ role: 'user', content: 'Hello' }] }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.type, 'api_error');
  } finally { await gateway.close(); }
});


test('native custom-model requests accept frontend instruction roles without overriding OpenCode', () => {
  const value = { model: 'fixture/probe', max_tokens: 32, messages: [
    { role: 'system', content: 'FRONTEND SYSTEM' }, { role: 'developer', content: 'FRONTEND DEVELOPER' },
    { role: 'user', content: 'Hello' },
  ] };
  assert.deepEqual(parseMessagesRequest(value, 'session').messages, [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]);
  assert.throws(() => parseMessagesRequest(value), /Unsupported message role/);
});


test('frontend tool advertisements do not replace or block native OpenCode tools', () => {
  const body = { model: 'fixture/probe', max_tokens: 32, messages: [{ role: 'user', content: 'Hello' }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }] };
  assert.deepEqual(parseMessagesRequest(body, 'session').tools, []);
  assert.throws(() => parseMessagesRequest(body), /server-side tool/);
});
