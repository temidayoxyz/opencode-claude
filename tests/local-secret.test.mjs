import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { localToken } from '../dist/config/store.js';

test('gateway-lifecycle: concurrent secret creation never observes partial keys or rotates them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oc-secret-'));
  const values = await Promise.all(Array.from({ length: 30 }, () => localToken(root)));
  assert.equal(new Set(values).size, 1);
  assert.match(values[0], /^[a-zA-Z0-9_-]{43}$/);
  assert.equal(await localToken(root), values[0]);
});
