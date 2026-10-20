import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGateway } from '../dist/gateway/server.js';
import { stopGateway } from '../dist/process/gateway.js';
import { localToken } from '../dist/config/store.js';

test('gateway-lifecycle: mismatched instance cannot stop another server and occupied ports fail', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oc-owner-'));
  const token = await localToken(root);
  let shutdowns = 0;
  const gateway = await createGateway({ token, adapter: {}, mappings: {}, shutdown: () => { shutdowns++; } });
  try {
    await writeFile(path.join(root, 'service.json'), JSON.stringify({ url: gateway.url, pid: process.pid, instance: '0'.repeat(32) }));
    assert.equal(await stopGateway(root), false);
    assert.equal(shutdowns, 0);
    await assert.rejects(createGateway({ token, adapter: {}, mappings: {}, port: Number(new URL(gateway.url).port) }), { code: 'EADDRINUSE' });
  } finally { await gateway.close(); }
});
