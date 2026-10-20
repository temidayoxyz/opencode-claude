import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const launch = (...args) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', windowsHide: true, timeout: 5000,
});

test('CLI identifies the installed development build', () => {
  const result = launch('--version');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^opencode-claude 0\.2\.0-dev\.1\r?\n$/);
});

test('CLI help describes experimental commands and eligibility limits', () => {
  const result = launch('--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /experimental/i);
  assert.match(result.stdout, /run claude/);
  assert.match(result.stdout, /restrictions still apply/i);
});

test('CLI rejects invalid commands before starting a gateway', () => {
  const result = launch('run', 'unknown');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Expected run claude/i);
});
