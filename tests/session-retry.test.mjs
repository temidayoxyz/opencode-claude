import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { parseMessagesRequest } from '../dist/gateway/messages.js';
import { ProviderError } from '../dist/opencode/access.js';

function fixture({ tool = false, denied = false } = {}) {
  let prompts = 0, created = 0, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const contexts = new Map();
  const client = {
    session: {
      async create() { const id = 'ses_' + ++created; contexts.set(id, []); return { id }; },
      async prompt({ sessionID }) {
        prompts++; entered();
        if (denied) contexts.set(sessionID, [{ type: 'assistant', id: 'denied', error: { status: 403, message: 'This free tier is only available within OpenCode' }, content: [] }]);
        else if (tool && prompts === 1) contexts.set(sessionID, [{ type: 'assistant', id: 'tool', content: [{ type: 'tool', id: 'write', name: 'write', executed: true, state: { status: 'completed' } }] }]);
        else if (prompts > 1) contexts.set(sessionID, [{ type: 'assistant', id: 'done', time: { completed: 1 }, content: [{ type: 'text', text: 'READY' }] }]);
      },
      async wait(input, { signal }) {
        if (prompts > 1 || denied || !signal) return;
        signal.throwIfAborted();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      },
      async context({ sessionID }) { return contexts.get(sessionID); },
      async interrupt() { return { interrupted: true }; },
      async get() { return { outcome: 'succeeded' }; },
      form: { async list() { return []; } },
    }, permission: { async list() { return []; } },
  };
  // A separate idle barrier after interrupt must resolve in this fake too.
  let stopped = false;
  const originalWait = client.session.wait;
  client.session.wait = (input, options = {}) => stopped ? Promise.resolve() : originalWait(input, options);
  client.session.interrupt = async () => { stopped = true; return { interrupted: true }; };
  const backend = createSessionBackend(client, { events: false });
  const source = parseMessagesRequest({ model: 'alias', max_tokens: 1, messages: [{ role: 'user', content: 'Hello' }] });
  const send = async signal => {
    let text = '';
    await backend.respond(source, { providerID: 'fixture', id: 'probe' },
      { id: 'desktop', directory: process.cwd(), kind: 'desktop', model: 'fixture/probe' },
      { async text(part) { text += part; }, complete() {} }, signal);
    return text;
  };
  return { backend, send, started, count: () => ({ prompts, created }) };
}

test('an interrupted initial model probe can retry after verified idle and no native tool activity', async () => {
  const f = fixture();
  const controller = new AbortController();
  try {
    const interrupted = assert.rejects(f.send(controller.signal));
    await f.started; controller.abort(); await interrupted;
    assert.equal(await f.send(AbortSignal.timeout(5000)), 'READY');
    assert.deepEqual(f.count(), { prompts: 2, created: 2 });
  } finally { await f.backend.close(); }
});

test('an interrupted task with a native tool action cannot rerun on retry', async () => {
  const f = fixture({ tool: true });
  const controller = new AbortController();
  try {
    const interrupted = assert.rejects(f.send(controller.signal));
    await f.started; controller.abort(); await interrupted;
    await assert.rejects(f.send(AbortSignal.timeout(5000)), /previous attempt failed or was interrupted/);
    assert.equal(f.count().prompts, 1);
  } finally { await f.backend.close(); }
});

test('a cached provider denial remains a provider denial instead of becoming invalid model HTTP 400', async () => {
  const f = fixture({ denied: true });
  try {
    for (let i = 0; i < 2; i++) await assert.rejects(f.send(AbortSignal.timeout(5000)), error => error instanceof ProviderError && error.status === 403);
    assert.equal(f.count().prompts, 1);
  } finally { await f.backend.close(); }
});

test('an expired native approval is identified before sending a stale permission reply', async () => {
  let pending = true, replies = 0, prompts = 0;
  const client = { session: {
    async create() { return { id: 'ses_expired' }; }, async prompt() { prompts++; }, async context() { return []; },
    async wait(input, { signal }) { await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); },
    async interrupt() {}, async get() { return { outcome: 'interrupted' }; }, form: { async list() { return []; } },
  }, permission: {
    async list() { return pending ? [{ id: 'permission_one', action: 'write', resources: ['fixture.txt'] }] : []; },
    async reply() { replies++;throw Error('Stale permission would return 404'); },
  } };
  const backend = createSessionBackend(client, { events: false });
  const messages = [{ role: 'user', content: 'start' }];
  const send = async () => { let output = '';await backend.respond(parseMessagesRequest({ model: 'alias', max_tokens: 1, messages }),
    { providerID: 'fixture', id: 'probe' }, { id: 'one', kind: 'claude', directory: process.cwd(), model: 'fixture/probe' },
    { async text(t) { output += t; }, complete() {} }, AbortSignal.timeout(5000));return output; };
  try {
    const text = await send();const code = /approve ([A-F0-9]{12})/.exec(text)[1];
    pending = false;
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: 'approve ' + code });
    await assert.rejects(send(), /no longer pending/);
    assert.equal(replies, 0);assert.equal(prompts, 1);
  } finally { await backend.close(); }
});
