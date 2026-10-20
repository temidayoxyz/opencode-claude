import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyProfile, restoreProfile } from '../dist/claude-desktop/profile.js';

test('desktop-profile: apply preserves profiles, repeated changes retain restore target', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oc-desktop-'));
  const old = '11111111-1111-4111-8111-111111111111';
  const meta = { appliedId: old, entries: [{ id: old, name: 'Existing' }] };
  await writeFile(path.join(root, '_meta.json'), JSON.stringify(meta));
  await writeFile(path.join(root, `${old}.json`), '{"private":"preserve"}');
  const connection = { url: 'http://127.0.0.1:1234', token: 'local-only' };
  const model = { alias: 'claude-sonnet-4-6-oc-test', name: 'Model' };
  const first = await applyProfile(root, root, connection, model);
  const second = await applyProfile(root, root, connection, { ...model, name: 'Other' });
  assert.equal(first.id, second.id);
  assert.equal(await readFile(path.join(root, `${old}.json`), 'utf8'), '{"private":"preserve"}');
  assert.equal(JSON.parse(await readFile(path.join(root, '_meta.json'), 'utf8')).entries.length, 2);
  assert.equal(await restoreProfile(root), true);
  assert.equal(JSON.parse(await readFile(path.join(root, '_meta.json'), 'utf8')).appliedId, old);
  assert.equal(await restoreProfile(root), false);
});
