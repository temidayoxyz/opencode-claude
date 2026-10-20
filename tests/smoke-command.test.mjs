import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createGateway } from '../dist/gateway/server.js';
import { modelAlias } from '../dist/config/models.js';
import { localToken } from '../dist/config/store.js';

test('provider-errors: opt-in smoke records real command success or denial with no fallback', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oc-smoke-'));
  const token = await localToken(root);
  let denied = false;
  let requests = 0;
  const model = { key: 'fixture/probe', alias: modelAlias('fixture/probe'), target: { providerID: 'fixture', id: 'probe' }, supported: true };
  const gateway = await createGateway({ token, mappings: { [model.alias]: model.target }, models: [model], adapter: {
    async generate(source, target, consume) {
      requests++;
      if (denied) throw new Error('403 FreeTierError PRIVATE_SECRET');
      await consume({ choices: [{ delta: { content: 'READY' }, finish_reason: 'stop' }] });
    },
  } });
  try {
    await writeFile(path.join(root, 'service.json'), JSON.stringify({ url: gateway.url, instance: gateway.instance, pid: process.pid }));
    async function check(...args) {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), ...args],
        { env: { ...process.env, OPENCODE_CLAUDE_HOME: root }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      return { code, output };
    }
    const success = await check('smoke', '--model', model.key);
    assert.equal(success.code, 0, success.output);
    assert.equal(JSON.parse(await readFile(path.join(root, 'access-check.json'), 'utf8')).result, 'passed (text only)');
    denied = true;
    const failure = await check('smoke', '--model', model.key);
    const record = JSON.parse(await readFile(path.join(root, 'access-check.json'), 'utf8'));
    assert.equal(failure.code, 1);
    assert.match(record.reason, /denied access/);
    assert.doesNotMatch(failure.output + JSON.stringify(record), /PRIVATE_SECRET/);
    assert.equal(requests, 2);
    await writeFile(path.join(root, 'settings.json'), JSON.stringify({ version: 1, defaultModel: 'removed/model' }));
    const setup = await check('setup');
    assert.equal(setup.code, 0);
    assert.match(setup.output, /no longer available/);
    assert.equal(JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8')).defaultModel, undefined);
  } finally { await gateway.close(); }
});
