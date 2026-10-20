import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { OpenCode } from '@opencode/client';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { launchRuntime } from '../dist/opencode/runtime.js';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { createGateway } from '../dist/gateway/server.js';

let directory, consumed = 0, writes = 0;
const fixture = await createFixture({ reply(body) {
  assert.ok(body.tools.some(t => t.function.name === 'shell'));
  assert.ok(body.tools.some(t => t.function.name === 'write'));
  assert.equal(JSON.stringify(body.messages).includes('PRIVATE_FRONTEND_SYSTEM'), false);
  const result = body.messages.findLast(m => m.role === 'tool');
  const resultIndex = body.messages.findLastIndex(m => m.role === 'tool');
  const userIndex = body.messages.findLastIndex(m => m.role === 'user');
  if (result && resultIndex > userIndex) {
    if (result.tool_call_id === 'native_question_proof') return { role: 'assistant', content: 'READY_NATIVE_QUESTION' };
    consumed++; return { role: 'assistant', content: 'READY_NATIVE_WRITE' };
  }
  const prompt = body.messages.findLast(m => m.role === 'user');
  if (JSON.stringify(prompt).includes('QUESTION_PROOF')) return { role: 'assistant', content: null, tool_calls: [{
    id: 'native_question_proof', type: 'function', function: { name: 'question', arguments: JSON.stringify({ questions: [{
      header: 'Local fixture', question: 'Choose Yes.', options: [{ label: 'Yes', description: 'Continue the fixture.' }, { label: 'No', description: 'Stop.' }],
    }] }) },
  }] };
  if (!JSON.stringify(prompt).includes('WRITE_PROOF')) return { role: 'assistant', reasoning_content: 'PRIVATE_SYNTHETIC_REASONING', content: 'READY_SECOND_TURN' };
  writes++;
  return { role: 'assistant', content: null, tool_calls: [{ id: 'native_write_proof', type: 'function', function: {
    name: 'write', arguments: JSON.stringify({ path: directory + '/proof.txt', content: 'ONE_NATIVE_WRITE' }),
  } }] };
} });
let runtime, backend, gateway;
try {
  runtime = await launchRuntime({ stateRoot: process.cwd() + '/.runtime', isolated: true, permissionMode: 'ask', config: {
    providers: { fixture: { package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
      models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } } } },
  } });
  directory = runtime.workspace;
  backend = createSessionBackend(OpenCode.make(runtime.connection));
  gateway = await createGateway({ sessions: backend, token: 'fixture-master', mappings: { alias: { providerID: 'fixture', id: 'probe' } } });
  const registration = await fetch(gateway.url + '/_clients', { method: 'POST', headers: { 'x-api-key': 'fixture-master' },
    body: JSON.stringify({ directory, kind: 'claude', model: 'fixture/probe' }) });
  assert.equal(registration.status, 200);
  const { token } = await registration.json();
  const send = (messages, stream = false) => fetch(gateway.url + '/v1/messages', { method: 'POST', headers: { 'x-api-key': token },
    signal: AbortSignal.timeout(30000), body: JSON.stringify({ model: 'alias', max_tokens: 128, stream, thinking: { type: 'adaptive' }, system: 'PRIVATE_FRONTEND_SYSTEM', messages }) });
  const messages = [{ role: 'user', content: 'WRITE_PROOF' }];
  let response = await send(messages);
  let value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  const permission = value.content[0].text;
  const code = /approve ([A-F0-9]{12})/.exec(permission)?.[1];
  assert.ok(code, permission);
  await assert.rejects(access(directory + '/proof.txt'));
  assert.equal((await fetch(gateway.url + '/_catalog', { headers: { 'x-api-key': token } })).status, 403);
  messages.push({ role: 'assistant', content: permission }, { role: 'user', content: `approve ${code}` });
  response = await send(messages);
  value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  const answer = value.content[0].text;
  assert.match(answer, /READY_NATIVE_WRITE/);
  assert.equal(await readFile(directory + '/proof.txt', 'utf8'), 'ONE_NATIVE_WRITE');
  assert.equal(consumed, 1);
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(value).includes('tool_use'), false, 'Never ask Claude to execute the native action again');
  assert.equal((await (await send(messages)).json()).content[0].text, answer, 'Retry replays without rerunning the tool');
  assert.equal(consumed, 1);
  messages.push({ role: 'assistant', content: answer }, { role: 'user', content: 'Second turn, no tool required.' });
  response = await send(messages);
  value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.match(value.content[0].text, /READY_SECOND_TURN/);
  const streaming = await send([{ role: 'user', content: 'Plain streamed reply.' }], true);
  const sse = await streaming.text();
  assert.match(sse, /event: message_start/);
  assert.equal((sse.match(/READY_SECOND_TURN/g) ?? []).length, 1);
  assert.doesNotMatch(sse, /PRIVATE_SYNTHETIC_REASONING/);
  assert.match(sse, /event: message_stop/);
  assert.doesNotMatch(sse, /tool_use/);
  const questions = [{ role: 'user', content: 'QUESTION_PROOF' }];
  let questionText = (await (await send(questions)).json()).content[0].text;
  for (let i = 0; i < 3 && /approve [A-F0-9]{12}/.test(questionText); i++) {
    const approval = /approve ([A-F0-9]{12})/.exec(questionText)[1];
    questions.push({ role: 'assistant', content: questionText }, { role: 'user', content: `approve ${approval}` });
    questionText = (await (await send(questions)).json()).content[0].text;
  }
  const answerCode = /Reply: answer ([A-F0-9]{12})/.exec(questionText)?.[1];
  assert.ok(answerCode, questionText);
  const fields = JSON.parse(/\n(\[\{.*\}\])\nReply: answer/.exec(questionText)[1]);
  const field = fields[0];
  const answerValue = field.options?.[0]?.value ?? 'Yes';
  questions.push({ role: 'assistant', content: questionText }, { role: 'user', content: `answer ${answerCode} ${JSON.stringify({ [field.key]: answerValue })}` });
  const answeredQuestion = await (await send(questions)).json();
  assert.match(answeredQuestion.content[0].text, /READY_NATIVE_QUESTION/);
  console.log('PASS: native write, permission approval, form answer, tool result, streaming, multiple turns and retry without duplicate execution');
} finally { await gateway?.close(); await backend?.close(); await runtime?.stop(); await fixture.close(); }
process.exit(0);
