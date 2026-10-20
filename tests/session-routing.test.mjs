import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { parseMessagesRequest } from '../dist/gateway/messages.js';

test('native sessions retain history, replay retries without executing twice, and isolate clients', async () => {
  const prompts = [], created = [];
  const contexts = new Map();
  const client = {
    session: {
      async create(input) { const id = `ses_${created.length}`; created.push(input); contexts.set(id, []); return { id }; },
      async prompt(input) {
        prompts.push(input);
        contexts.get(input.sessionID).push({ type: 'assistant', id: `msg_${prompts.length}`,
          content: [{ type: 'text', text: 'READY' }], tokens: { input: 10, output: 5, cache: { read: 0, write: 0 } } });
      },
      async wait() {},
      async context({ sessionID }) { return contexts.get(sessionID); },
      async get() { return { outcome: 'succeeded' }; },
      async interrupt() {},
      form: { async list() { return []; } },
    },
    permission: { async list() { return []; } },
    model: { async list() { return { location: {}, data: [] }; } },
  };
  const backend = createSessionBackend(client, { events: false });
  const context = { id: 'one', directory: process.cwd(), kind: 'claude', model: 'fixture/probe' };
  const target = { providerID: 'fixture', id: 'probe' };
  const make = (messages) => parseMessagesRequest({ model: 'alias', max_tokens: 32, system: 'PRIVATE FRONTEND SYSTEM',
    tools: [{ name: 'FRONTEND_TOOL', input_schema: {} }], messages });
  const first = [{ role: 'user', content: 'first' }];
  const respond = async (messages, ctx = context) => {
    let text = '';
    await backend.respond(make(messages), target, ctx, { async text(delta) { text += delta; }, complete() {} }, new AbortController().signal);
    return text;
  };
  try {
    assert.deepEqual(await backend.models(), { location: {}, data: [] });
    assert.equal(await respond(first), 'READY');
    assert.equal(await respond(first), 'READY');
    assert.equal(prompts.length, 1, 'Retry must not rerun native actions');
    await respond([...first, { role: 'assistant', content: 'READY' }, { role: 'user', content: 'second' }]);
    assert.equal(created.length, 1);
    assert.deepEqual(prompts.map(p => p.text), ['first', 'second']);
    await assert.rejects(respond([...first, { role: 'assistant', content: 'READY' }, { role: 'user', content: 'branch from old turn' }]), /new conversation/);
    assert.equal(Object.hasOwn(created[0], 'permissions'), false, 'Inherit genuine OpenCode permissions');
    assert.equal(JSON.stringify(prompts).includes('FRONTEND'), false);
    await respond(first, { ...context, id: 'two' });
    assert.equal(created.length, 2);
    await assert.rejects(respond([{ role: 'user', content: 'unknown' }, { role: 'assistant', content: 'old' }, { role: 'user', content: 'continue' }]), /new conversation/);
  } finally { await backend.close(); }
});

test('native session creation reserves concurrency and deduplication before awaiting the server', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let created = 0;
  const client = {
    session: {
      async create() { const id = `ses_${++created}`; await gate; return { id }; },
      async prompt() {}, async wait() {}, async interrupt() {},
      async context() { return [{ type: 'assistant', id: 'reply', time: { completed: 1 }, content: [{ type: 'text', text: 'READY' }] }]; },
      async get() { return { outcome: 'succeeded' }; }, form: { async list() { return []; } },
    },
    permission: { async list() { return []; } },
  };
  const backend = createSessionBackend(client, { events: false });
  const source = parseMessagesRequest({ model: 'alias', max_tokens: 32, messages: [{ role: 'user', content: 'work' }] });
  const send = id => backend.respond(source, { providerID: 'fixture', id: 'probe' },
    { id, directory: process.cwd(), kind: 'claude', model: 'fixture/probe' }, { async text() {}, complete() {} }, AbortSignal.timeout(5000));
  const running = Array.from({ length: 8 }, (_, i) => send(String(i)));
  try {
    await assert.rejects(send('0'), /already running/);
    await assert.rejects(send('ninth'), /Eight/);
    assert.equal(created, 8);
  } finally { release(); await Promise.allSettled(running); await backend.close(); }
  await Promise.all(running);
});
