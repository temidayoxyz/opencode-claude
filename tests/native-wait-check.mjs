import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OpenCode } from '@opencode/client';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { launchRuntime } from '../dist/opencode/runtime.js';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { waitForSession } from '../dist/opencode/wait.js';
import { parseMessagesRequest } from '../dist/gateway/messages.js';

const long = process.argv.includes('--long');
const holdMs = long ? 310000 : 2200;
let runtime, backend, writes = 0, consumed = 0, entered, sessionID, releaseTimer, ticker;
const started = new Promise(resolve => { entered = resolve; });
const fixture = await createFixture({ keepAliveMs: 1000, async reply(body, { signal }) {
  if (body.messages.findLastIndex(m => m.role === 'tool') > body.messages.findLastIndex(m => m.role === 'user')) {
    consumed++; entered();
    await new Promise((resolve, reject) => {
      releaseTimer = setTimeout(resolve, holdMs);
      signal.addEventListener('abort', () => reject(Error('Native execution was unexpectedly interrupted')), { once: true });
    });
    return { role: 'assistant', content: 'READY_AFTER_LONG_TASK' };
  }
  writes++;
  return { role: 'assistant', content: null, tool_calls: [{ id: 'native_long_write', type: 'function', function: {
    name: 'write', arguments: JSON.stringify({ path: runtime.workspace + '/wait-proof.txt', content: 'ONE_WRITE_THROUGH_LONG_WAIT' }),
  } }] };
} });
try {
  runtime = await launchRuntime({ stateRoot: process.cwd() + '/.runtime', isolated: true, permissionMode: 'allow', config: {
    providers: { fixture: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
      models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } } } },
  } });
  const client = OpenCode.make(runtime.connection);
  let backendWaits = 0;
  const observed = { ...client, session: { ...client.session,
    async create(...args) { const info = await client.session.create(...args);sessionID = info.id;return info; },
    async wait(...args) { backendWaits++;return client.session.wait(...args); },
  } };
  backend = createSessionBackend(observed);
  let output = '';
  const signal = AbortSignal.timeout(holdMs + 30000);
  const running = backend.respond(parseMessagesRequest({ model: 'alias', max_tokens: 128, messages: [{ role: 'user', content: 'WRITE_THEN_LONG_WAIT' }] }, 'session'),
    { providerID: 'fixture', id: 'probe' }, { id: 'wait-proof', directory: runtime.workspace, kind: 'desktop', model: 'fixture/probe' },
    { async text(t) { output += t; }, complete() {} }, signal);
  await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(Error('Native write did not start')), 15000).unref())]);
  assert.equal(await readFile(runtime.workspace + '/wait-proof.txt', 'utf8'), 'ONE_WRITE_THROUGH_LONG_WAIT');
  let observation;
  if (long) {
    // The unmodified SDK wait exposes the original five-minute transport cutoff.
    observation = client.session.wait({ sessionID }, { signal }).then(() => ({ failed: false }), cause => {
      const codes = [];let e = cause;
      for (let i = 0; e && i < 6; i++, e = e.cause) if (typeof e.code === 'string') codes.push(e.code);
      return { failed: true, codes };
    });
    const began = Date.now();
    ticker = setInterval(() => console.log(JSON.stringify({ elapsedSeconds: Math.round((Date.now()-began)/1000), renewedWaits: backendWaits, nativeWrites: writes })), 60000);
  } else observation = waitForSession(client, sessionID, signal, 200);
  await running;
  const original = await observation;
  if (long) { assert.equal(original.failed, true);assert.ok(original.codes.includes('UND_ERR_HEADERS_TIMEOUT'), JSON.stringify(original));assert.ok(backendWaits >= 5); }
  assert.match(output, /READY_AFTER_LONG_TASK/);
  assert.equal(writes, 1);assert.equal(consumed, 1);
  assert.equal(await readFile(runtime.workspace + '/wait-proof.txt', 'utf8'), 'ONE_WRITE_THROUGH_LONG_WAIT');
  console.log(JSON.stringify({ passed: true, mode: long ? '310-second reproduction' : 'short fixture', nativeWrites: writes, backendWaits, originalWait: long ? original : undefined }));
} catch (cause) {
  console.log(JSON.stringify({failed:true,writes,consumed,providerRequests:(await fixture.status()).modelRequests,errorName:cause.name,code:cause.code}));
  throw cause;
} finally { clearTimeout(releaseTimer);clearInterval(ticker);await backend?.close();await runtime?.stop();await fixture.close(); }
process.exit(0);
