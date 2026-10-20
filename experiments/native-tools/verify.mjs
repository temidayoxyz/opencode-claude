import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createFixture } from './fixture-model.mjs';
import { startRuntime } from './runtime.mjs';

async function eventually(read, predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const fixture = await createFixture();
let runtime;
try {
  const unauthorized = await fetch(fixture.url + '/bridge/status');
  assert.equal(unauthorized.status, 401);
  runtime = await startRuntime(fixture);

  async function session() {
    const response = await runtime.api('POST', '/api/session', {
      title: 'Disposable external-tool compatibility test',
      model: { providerID: 'fixture', id: 'probe' },
      location: { directory: runtime.workspace },
      permissions: [{ action: '*', resource: '*', effect: 'deny' },
        { action: 'external_counter', resource: '*', effect: 'allow' }],
    });
    assert.equal(typeof response.data?.id, 'string');
    return response.data.id;
  }
  async function prompt(id) {
    await runtime.api('POST', `/api/session/${id}/prompt`, {
      text: 'Call external_counter with delta 1 once, then report its returned value.',
    });
  }

  const id = await session();
  await prompt(id);
  const status = await eventually(
    fixture.status,
    (value) => value.calls.some((call) => call.sessionID === id && call.state === 'pending'),
    'a tool request from the actual OpenCode runtime',
  );
  const call = status.calls.find((item) => item.sessionID === id && item.state === 'pending');
  assert.equal(call.name, 'external_counter');
  assert.deepEqual(call.input, { delta: 1 });

  // The external caller performs the action. The plugin only waits for its result.
  let externalCounter = 0;
  externalCounter += call.input.delta;
  await fixture.result(call.key, { value: externalCounter });
  assert.equal(await fixture.duplicateResultStatus(call.key), 409);
  await runtime.api('POST', `/api/experimental/session/${id}/wait`);
  const context = await runtime.api('GET', `/api/session/${id}/context`);
  assert.match(JSON.stringify(context.data), /EXTERNAL_COUNTER=1/);
  assert.equal(externalCounter, 1);
  const completed = (await fixture.status()).calls.filter((item) => item.sessionID === id);
  assert.equal(completed.length, 1, 'The model must not request a duplicate action');
  assert.equal(completed[0].state, 'completed');

  const cancelledID = await session();
  await prompt(cancelledID);
  await eventually(fixture.status, (value) => value.calls.some(
    (item) => item.sessionID === cancelledID && item.state === 'pending',
  ), 'the cancellable tool request');
  const interrupted = await runtime.api('POST', `/api/session/${cancelledID}/interrupt`);
  assert.equal(interrupted.interrupted, true);
  await eventually(fixture.status, (value) => value.calls.some(
    (item) => item.sessionID === cancelledID && item.state === 'cancelled',
  ), 'cancellation reaching the plugin tool');
  assert.equal(externalCounter, 1, 'Cancelling a pending tool must not execute it');

  const generateID = await session();
  await runtime.api('POST', `/api/session/${generateID}/generate`, {
    prompt: 'Call external_counter with delta 1.',
  });
  const captured = await fixture.captured(generateID);
  assert.equal(captured?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name, 'external_counter');
  assert.equal((await fixture.status()).calls.filter((item) => item.sessionID === generateID).length, 0,
    'Transient generation must return the tool call without executing even the relay');

  console.log(JSON.stringify({
    result: 'PASS', runtimeVersion: runtime.version,
    model: 'deterministic loopback fixture', externalExecutionCount: externalCounter,
    resultConsumed: true, cancellationForwarded: true, duplicateResultRejected: true,
    transientToolResponseCaptured: true, transientToolExecutions: 0,
    claudeClientTested: false, liveFreeModelTested: false,
  }, null, 2));
} catch (error) {
  console.error('Runtime diagnostics:', runtime?.diagnostics() ?? 'runtime not started');
  console.error('Fixture status:', JSON.stringify(await fixture.status()));
  throw error;
} finally {
  await runtime?.stop();
  await fixture.close();
}
