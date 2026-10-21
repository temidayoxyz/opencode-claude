import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { OpenCode } from '@opencode/client';
import { waitForSession } from '../dist/opencode/wait.js';

test('long native waits renew only the observation request, without interrupting or resubmitting work', async () => {
  let observations = 0, interrupted = 0, prompts = 0;
  const client = { session: {
    async wait(input, { signal }) {
      assert.equal(input.sessionID, 'ses_one');
      if (++observations === 3) return;
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }, async interrupt() { interrupted++; }, async prompt() { prompts++; },
  } };
  await waitForSession(client, 'ses_one', AbortSignal.timeout(1000), 10);
  assert.equal(observations, 3); assert.equal(interrupted, 0); assert.equal(prompts, 0);
});

test('a caller cancellation terminates renewed observation promptly', async () => {
  const controller = new AbortController();let observations = 0;
  const client = { session: { async wait(input, { signal }) {
    observations++;
    await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); controller.abort(Error('User cancelled')); });
  } } };
  await assert.rejects(waitForSession(client, 'ses_one', controller.signal, 10), /User cancelled/);
  assert.equal(observations, 1);
});

test('native wait failures are not hidden or retried as lease expiry', async () => {
  const cause = Error('Real native failure');let observations = 0;
  const client = { session: { async wait() { observations++;throw cause; } } };
  await assert.rejects(waitForSession(client, 'ses_one', AbortSignal.timeout(1000), 10), e => e === cause);
  assert.equal(observations, 1);
});

test('the official SDK can cancel and renew pending HTTP waits until native idle', async () => {
  let observations = 0, disconnected = 0;
  const server = createServer((req, res) => {
    assert.equal(req.url, '/api/experimental/session/ses_one/wait');
    res.once('close', () => { if (!res.writableEnded) disconnected++; });
    if (++observations === 3) { res.writeHead(204); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:' + server.address().port });
  try {
    await waitForSession(client, 'ses_one', AbortSignal.timeout(5000), 100);
    assert.equal(observations, 3);assert.equal(disconnected, 2);
  } finally { await new Promise(resolve => { server.close(resolve);server.closeAllConnections(); }); }
});
