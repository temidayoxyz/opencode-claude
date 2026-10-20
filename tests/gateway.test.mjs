import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../dist/gateway/server.js';

test('messages-text: gateway validates auth, origin, mappings and content', async () => {
  let calls = 0;
  const gateway = await createGateway({ token: 'local-test', mappings: { alias: { providerID: 'fixture', id: 'text' } }, adapter: {
    async generate(source, target, consume) {
      calls++;
      assert.equal(target.id, 'text');
      await consume({ choices: [{ delta: { content: 'READY' }, finish_reason: 'stop' }] });
    },
  } });
  const request = { model: 'alias', max_tokens: 10, messages: [{ role: 'user', content: 'hello' }] };
  const send = (value, headers = { 'x-api-key': 'local-test' }) => fetch(gateway.url + '/v1/messages', { method: 'POST', headers, body: JSON.stringify(value) });
  try {
    assert.equal((await send(request, {})).status, 401);
    assert.equal((await send(request, { 'x-api-key': 'local-test', origin: 'https://example.com' })).status, 403);
    assert.equal((await send({ ...request, model: 'unknown' })).status, 400);
    const oversized = await send({ ...request, messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }] });
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error.message, /exceeds/);
    assert.equal((await send({ ...request, messages: [{ role: 'user', content: [{ type: 'image' }] }] })).status, 400);
    assert.equal((await (await send(request)).json()).content[0].text, 'READY');
    const response = await send({ ...request, stream: true });
    const events = await response.text();
    assert.match(events, /event: message_start/);
    assert.match(events, /event: message_stop/);
    assert.equal(calls, 2);
  } finally { await gateway.close(); }
});

test('conversation-isolation: disconnect aborts only the matching generation', async () => {
  const seen = new Map();
  const gateway = await createGateway({ token: 'local-test', mappings: { alias: { providerID: 'fixture', id: 'text' } }, adapter: {
    async generate(source, target, consume, signal) {
      const text = source.messages[0].content;
      if (text === 'wait') {
        seen.set(text, signal);
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        throw new Error('aborted');
      }
      await consume({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] });
    },
  } });
  try {
    const controller = new AbortController();
    const slow = await fetch(gateway.url + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'local-test' }, signal: controller.signal,
      body: JSON.stringify({ model: 'alias', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'wait' }] }) });
    const reader = slow.body.getReader();
    await reader.read();
    controller.abort();
    for (let i = 0; i < 50 && !seen.get('wait')?.aborted; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(seen.get('wait')?.aborted, true);
    const fast = await fetch(gateway.url + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'local-test' },
      body: JSON.stringify({ model: 'alias', max_tokens: 10, messages: [{ role: 'user', content: 'separate' }] }) });
    assert.equal((await fast.json()).content[0].text, 'separate');
  } finally { await gateway.close(); }
});

test('messages-stream: midstream errors are sanitized and never emit a false completion', async () => {
  const gateway = await createGateway({ token: 'local-test', mappings: { alias: { providerID: 'fixture', id: 'text' } }, adapter: {
    async generate(source, target, consume) {
      await consume({ choices: [{ delta: { content: 'Partial' } }] });
      throw new Error('PRIVATE_PROMPT PRIVATE_KEY');
    },
  } });
  try {
    const response = await fetch(gateway.url + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'local-test' },
      body: JSON.stringify({ model: 'alias', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hello' }] }) });
    const events = await response.text();
    assert.match(events, /event: error/);
    assert.doesNotMatch(events, /PRIVATE_|event: message_stop/);
  } finally { await gateway.close(); }
});
