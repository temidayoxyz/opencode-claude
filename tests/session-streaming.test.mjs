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

test('native tool events render one editing group and retries replay without another native prompt', async () => {
  let onEvent, finish, context = [], prompts = 0;
  const ended = new Promise(resolve => { finish = resolve; });
  const tools = Array.from({ length: 7 }, (_, i) => ({ type: 'tool', id: 'edit_' + i, name: 'edit' }));
  const client = {
    event: { async *subscribe({ signal }) {
      const queue = [];let wake;
      onEvent = event => { queue.push(event);wake?.(); };
      while (!signal.aborted) {
        if (!queue.length) await new Promise(resolve => { wake = resolve;signal.addEventListener('abort', resolve, { once: true }); });
        while (queue.length) yield queue.shift();
      }
    } },
    session: {
      async create() { return { id: 'ses_progress' }; }, async context() { return context; },
      async prompt() {
        prompts++;
        for (const tool of tools) {
          const event = { type: 'session.tool.input.started', id: 'event_' + tool.id,
            data: { sessionID: 'ses_progress', id: tool.id, name: tool.name } };
          onEvent(event);onEvent(event);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
        context = [{ type: 'assistant', id: 'edits', time: { completed: 1 }, content: tools },
          { type: 'assistant', id: 'answer', time: { completed: 2 }, content: [{ type: 'text', text: 'READY' }] }];
        finish();
      }, async wait() { await ended; }, async get() { return { outcome: 'succeeded' }; }, async interrupt() {},
      form: { async list() { return []; } },
    }, permission: { async list() { return []; } },
  };
  const backend = createSessionBackend(client);
  const source = parseMessagesRequest({ model: 'alias', max_tokens: 32, messages: [{ role: 'user', content: 'Edit the fixture.' }] });
  async function send() { let output = '';await backend.respond(source, { providerID: 'fixture', id: 'probe' },
    { id: 'client', directory: process.cwd(), kind: 'desktop', model: 'fixture/probe' },
    { async text(t) { output += t; }, complete() {} }, AbortSignal.timeout(5000));return output; }
  try {
    const output = await send();
    assert.equal((output.match(/Updating files/g) ?? []).length, 1);
    assert.equal((output.match(/File updates: 7 operations/g) ?? []).length, 1);
    assert.equal((output.match(/READY/g) ?? []).length, 1);
    assert.ok(output.indexOf('File updates: 7 operations') < output.indexOf('READY'));
    assert.doesNotMatch(output, /OpenCode tool|tool_use|edit_[0-9]/);
    assert.equal(await send(), output);assert.equal(prompts, 1);
  } finally { await backend.close(); }
});
