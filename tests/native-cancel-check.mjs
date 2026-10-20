import assert from 'node:assert/strict';
import { OpenCode } from '@opencode/client';
import { readFile } from 'node:fs/promises';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { launchRuntime } from '../dist/opencode/runtime.js';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { parseMessagesRequest } from '../dist/gateway/messages.js';
let entered, disconnected, slowRequests = 0, actionEntered, actionDisconnected, nativeWrites = 0;
const actionStarted = new Promise(resolve => { actionEntered = resolve; });
const actionCancelled = new Promise(resolve => { actionDisconnected = resolve; });
const started = new Promise(r => { entered = r; });
const cancelled = new Promise(r => { disconnected = r; });
const fixture = await createFixture({ async reply(body, { signal }) {
  if (JSON.stringify(body.messages.findLast(m => m.role === 'user')).includes('WRITE_THEN_WAIT')) {
    if (body.messages.findLastIndex(m => m.role === 'tool') > body.messages.findLastIndex(m => m.role === 'user')) {
      actionEntered();
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
      actionDisconnected();
      return { role: 'assistant', content: 'READY' };
    }
    nativeWrites++;
    return { role: 'assistant', content: null, tool_calls: [{ id: 'native_cancel_write', type: 'function', function: {
      name: 'write', arguments: JSON.stringify({ path: runtime.workspace + '/cancel-proof.txt', content: 'ONE_WRITE_BEFORE_CANCEL' }),
    } }] };
  }
  if (JSON.stringify(body.messages.findLast(m => m.role === 'user')).includes('SLOW_NATIVE') && ++slowRequests === 1) {
    entered();
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    disconnected();
  }
  return { role: 'assistant', content: 'READY' };
} });
let runtime, backend;
try {
  runtime = await launchRuntime({ stateRoot: process.cwd() + '/.runtime', isolated: true, permissionMode: 'allow', config: {
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
  assert.equal(await send('slow', 'SLOW_NATIVE', AbortSignal.timeout(15000)), 'READY');
  assert.equal(slowRequests, 2);
  assert.equal(await fast, 'READY');
  await Promise.race([cancelled, new Promise((_, reject) => setTimeout(() => reject(Error('Provider did not disconnect')), 10000).unref())]);
  const actionController = new AbortController();
  const actionRequest = assert.rejects(send('action', 'WRITE_THEN_WAIT', actionController.signal));
  await Promise.race([actionStarted, new Promise((_, reject) => setTimeout(() => reject(Error('Native write did not reach the waiting step')), 15000).unref())]);
  actionController.abort();
  await actionRequest;
  await assert.rejects(send('action', 'WRITE_THEN_WAIT', AbortSignal.timeout(5000)), /previous attempt failed or was interrupted/);
  assert.equal(await readFile(runtime.workspace + '/cancel-proof.txt', 'utf8'), 'ONE_WRITE_BEFORE_CANCEL');
  assert.equal(nativeWrites, 1);
  await Promise.race([actionCancelled, new Promise((_, reject) => setTimeout(() => reject(Error('Provider after native write did not disconnect')), 10000).unref())]);
  assert.ok(await client.server.info());
  console.log('PASS: cancelled text-only probes may retry; interrupted native writes never repeat; other conversations and service remain intact');
} finally { await backend?.close(); await runtime?.stop(); await fixture.close(); }
process.exit(0);
