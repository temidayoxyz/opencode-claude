import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { parseMessagesRequest } from '../dist/gateway/messages.js';

test('native text reconciliation follows text order and deduplicates replayed events', async () => {
  let onEvent, finish, context = [];
  const ended = new Promise(resolve => { finish = resolve; });
  const expected = 'A single response with two text parts.';
  const client = {
    event: { async *subscribe({ signal }) {
      const queue = []; let wake;
      onEvent = event => { queue.push(event); wake?.(); };
      while (!signal.aborted) {
        if (!queue.length) await new Promise(resolve => { wake = resolve; signal.addEventListener('abort', resolve, { once: true }); });
        while (queue.length) yield queue.shift();
      }
    } },
    session: {
      async create() { return { id: 'ses_stream' }; },
      async context() { return context; },
      async prompt() {
        const delta = { type: 'session.text.delta', id: 'event_1', data: { sessionID: 'ses_stream', assistantMessageID: 'm', ordinal: 0, delta: 'A single response ' } };
        onEvent(delta); onEvent(delta);
        onEvent({ type: 'session.text.delta', id: 'event_2', data: { ...delta.data, ordinal: 1, delta: 'with two text parts.' } });
        await new Promise(resolve => setTimeout(resolve, 10));
        context = [{ type: 'assistant', id: 'm', time: { completed: 1 }, content: [
          { type: 'reasoning', text: 'PRIVATE_REASONING' },
          { type: 'text', text: 'A single response ' },
          { type: 'reasoning', text: 'PRIVATE_REASONING' },
          { type: 'text', text: 'with two text parts.' },
        ] }];
        finish();
      },
      async wait() { await ended; }, async get() { return { outcome: 'succeeded' }; }, async interrupt() { return { interrupted: true }; },
      form: { async list() { return []; } },
    },
    permission: { async list() { return []; } },
  };
  const backend = createSessionBackend(client);
  let output = '';
  try {
    await backend.respond(parseMessagesRequest({ model: 'alias', max_tokens: 64, messages: [{ role: 'user', content: 'Say one response.' }] }),
      { providerID: 'fixture', id: 'probe' }, { id: 'client', directory: process.cwd(), kind: 'desktop', model: 'fixture/probe' },
      { async text(value) { output += value; }, complete() {} }, AbortSignal.timeout(5000));
    assert.equal(output, expected);
    assert.doesNotMatch(output, /PRIVATE_REASONING/);
  } finally { await backend.close(); }
});
