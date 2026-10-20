import assert from 'node:assert/strict';
import { OpenCode } from '@opencode/client';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { launchRuntime } from '../dist/opencode/runtime.js';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { parseMessagesRequest } from '../dist/gateway/messages.js';
let entered, disconnected;
const started = new Promise(r => { entered = r; });
const cancelled = new Promise(r => { disconnected = r; });
const fixture = await createFixture({ async reply(body, { signal }) {
  if (JSON.stringify(body.messages.findLast(m => m.role === 'user')).includes('SLOW_NATIVE')) {
    entered();
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    disconnected();
  }
  return { role: 'assistant', content: 'READY' };
} });
let runtime, backend;
try {
  runtime = await launchRuntime({ stateRoot: process.cwd() + '/.runtime', isolated: true, config: {
    providers: { fixture: { package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
      models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } } } },
  } });
  const client = OpenCode.make(runtime.connection);
  backend = createSessionBackend(client);
  const controller = new AbortController();
  const send = (id, prompt, signal) => {
    let text = '';
    return backend.respond(parseMessagesRequest({ model: 'alias', max_tokens: 32, messages: [{ role: 'user', content: prompt }] }),
      { providerID: 'fixture', id: 'probe' }, { id, directory: runtime.workspace, kind: 'claude', model: 'fixture/probe' },
      { async text(t) { text += t; }, complete() {} }, signal).then(() => text);
  };
  const slow = send('slow', 'SLOW_NATIVE', controller.signal);
  const rejected = assert.rejects(slow);
  await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(Error('Slow request did not start')), 15000).unref())]);
  const fast = send('fast', 'Reply READY.', AbortSignal.timeout(15000));
  controller.abort();
  await rejected;
  await assert.rejects(send('slow', 'SLOW_NATIVE', AbortSignal.timeout(15000)), /previous attempt failed or was interrupted/);
  assert.equal(await fast, 'READY');
  await Promise.race([cancelled, new Promise((_, reject) => setTimeout(() => reject(Error('Provider did not disconnect')), 10000).unref())]);
  assert.ok(await client.server.info());
  console.log('PASS: native session cancellation reaches its provider; concurrent conversation and OpenCode service remain intact');
} finally { await backend?.close(); await runtime?.stop(); await fixture.close(); }
process.exit(0);
