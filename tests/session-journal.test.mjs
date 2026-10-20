import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { openSessionJournal } from '../dist/opencode/journal.js';
import { parseMessagesRequest } from '../dist/gateway/messages.js';

function fixture() {
  let prompts = 0, created = 0;
  const messages = new Map();
  return { count: () => ({ prompts, created }), client: {
    session: {
      async create() { const id = 'ses_' + ++created; messages.set(id, []); return { id }; },
      async prompt({ sessionID }) { prompts++; messages.get(sessionID).push({ type: 'assistant', id: 'msg_' + prompts,
        time: { completed: 1 }, content: [{ type: 'text', text: 'READY' }] }); },
      async context({ sessionID }) { return messages.get(sessionID); }, async wait() {}, async interrupt() {},
      async get() { return { outcome: 'succeeded' }; }, form: { async list() { return []; } },
    }, permission: { async list() { return []; } },
  } };
}
const context = { id: 'client-one', kind: 'claude', directory: process.cwd(), model: 'fixture/probe' };
const first = [{ role: 'user', content: 'PRIVATE PROMPT MUST NOT BE JOURNALED' }];
function send(backend, messages, ctx = context) {
  let text = '';
  return backend.respond(parseMessagesRequest({ model: 'alias', max_tokens: 131072, messages }, 'session'),
    { providerID: 'fixture', id: 'probe' }, ctx, { async text(t) { text += t; }, complete() {} }, AbortSignal.timeout(5000)).then(() => text);
}

test('completed native sessions and retry replies survive a gateway restart without replaying actions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oc-journal-'));
  const file = path.join(root, 'sessions.json');
  const f = fixture();
  let backend = createSessionBackend(f.client, { events: false, journal: await openSessionJournal(file) });
  assert.equal(await send(backend, first), 'READY');
  await backend.close();
  assert.equal((await readFile(file, 'utf8')).includes('PRIVATE PROMPT'), false);
  backend = createSessionBackend(f.client, { events: false, journal: await openSessionJournal(file) });
  try {
    assert.equal(await send(backend, first), 'READY');
    assert.deepEqual(f.count(), { prompts: 1, created: 1 });
    const next = [...first, { role: 'assistant', content: 'READY' }, { role: 'user', content: 'continue' }];
    await assert.rejects(send(backend, next, { ...context, id: 'another-client' }), /unknown/);
    assert.equal(await send(backend, next), 'READY');
    assert.deepEqual(f.count(), { prompts: 2, created: 1 });
  } finally { await backend.close(); }
});

test('an interrupted journal protects both exact retries and changed prompts after restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oc-journal-block-'));
  const file = path.join(root, 'sessions.json');
  const f = fixture();
  let journal = await openSessionJournal(file);
  let backend = createSessionBackend(f.client, { events: false, journal });
  await send(backend, first); await backend.close();
  const state = JSON.parse(await readFile(file, 'utf8'));
  state.conversations[0].blocked = true;
  state.requests[0] = { key: state.requests[0].key, failure: true };
  await writeFile(file, JSON.stringify(state));
  journal = await openSessionJournal(file);
  backend = createSessionBackend(f.client, { events: false, journal });
  try {
    await assert.rejects(send(backend, first), /previous attempt/);
    await assert.rejects(send(backend, [...first, { role: 'assistant', content: 'READY' }, { role: 'user', content: 'different task' }]), /interrupted/);
    assert.deepEqual(f.count(), { prompts: 1, created: 1 });
  } finally { await backend.close(); }
});

test('corrupted session state fails closed rather than discarding retry protection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oc-journal-bad-'));
  const file = path.join(root, 'sessions.json');
  for (const value of ['broken JSON', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, conversations: [], requests: [{ key: 'bad' }] })]) {
    await writeFile(file, value);
    await assert.rejects(openSessionJournal(file));
  }
});

test('retry protection reaches disk before OpenCode can execute a prompt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oc-journal-crash-'));
  const file = path.join(root, 'sessions.json');
  const f = fixture();
  let calls = 0;
  f.client.session.prompt = async () => {
    calls++;
    const reservation = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(reservation.requests[0].failure, true);
    assert.equal(reservation.conversations[0].blocked, true);
    throw Error('Simulated connection loss after native submission');
  };
  let backend = createSessionBackend(f.client, { events: false, journal: await openSessionJournal(file) });
  await assert.rejects(send(backend, first), /connection loss/);
  await backend.close();
  backend = createSessionBackend(f.client, { events: false, journal: await openSessionJournal(file) });
  try { await assert.rejects(send(backend, first), /previous attempt/); assert.equal(calls, 1); }
  finally { await backend.close(); }
});
