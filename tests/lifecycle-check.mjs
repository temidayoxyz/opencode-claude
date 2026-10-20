import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = await mkdtemp(fileURLToPath(new URL('../.runtime/lifecycle-', import.meta.url)));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
async function command(...args) {
  const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, OPENCODE_CLAUDE_HOME: root }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, output); return output;
}
try {
  await writeFile(path.join(root, 'service.json'), JSON.stringify({ url: 'http://127.0.0.1:1', instance: '0'.repeat(32), pid: 999999 }));
  const starts = await Promise.all([command('start'), command('start'), command('start')]);
  assert.equal(new Set(starts).size, 1, 'Concurrent starts reuse one owned worker');
  const state = JSON.parse(await readFile(path.join(root, 'service.json'), 'utf8'));
  assert.equal((await fetch(state.url + '/health')).status, 401);
  await command('setup');
  await command('model', 'set', 'opencode/deepseek-v4.1-flash-free');
  const saved = JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8'));
  assert.equal(saved.defaultModel, 'opencode/deepseek-v4.1-flash-free');
  await command('desktop', 'export');
  assert.equal(JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8')).defaultModel, saved.defaultModel);
  await command('stop');
  await assert.rejects(readFile(path.join(root, 'service.json')), { code: 'ENOENT' });
  await command('stop');
} finally { await command('stop'); }
console.log('PASS: concurrent starts, authenticated state, setup/catalog/default/export, owned shutdown, repeated stop');
