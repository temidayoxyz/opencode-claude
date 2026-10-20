import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const launch = (...args) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', windowsHide: true, timeout: 5000,
});

test('CLI identifies the installed development build', () => {
  const result = launch('--version');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^opencode-claude 0\.1\.0-dev\.0\r?\n$/);
});

test('CLI help makes the compatibility research status clear', () => {
  const result = launch('--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /compatibility research/i);
  assert.match(result.stdout, /not available yet/i);
});

test('CLI does not pretend the unimplemented launch command works', () => {
  const result = launch('run', 'claude');
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /not available yet/i);
});
