import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { createAdapter } from '../dist/opencode/adapter.js';
import { createGateway } from '../dist/gateway/server.js';
import { modelAlias } from '../dist/config/models.js';

if (!process.argv.includes('--fixture')) throw new Error('This check requires --fixture and never calls a hosted model');
const stateRoot = fileURLToPath(new URL('../.runtime/', import.meta.url));
const workspace = await mkdtemp(path.join(stateRoot, 'claude-check-'));
let resultsConsumed = 0;
const fixture = await createFixture({ reply(body) {
  const result = body.messages.findLast(m => m.role === 'tool');
  if (result) {
    assert.match(JSON.stringify(result.content), /file|success|written/i);
    resultsConsumed++;
    return { role: 'assistant', content: 'READY' };
  }
  if (!body.tools?.some(t => t.function.name === 'Write')) return { role: 'assistant', content: 'READY' };
  return { role: 'assistant', content: null, tool_calls: [{ id: 'call_fixture_write', type: 'function', function: {
    name: 'Write', arguments: JSON.stringify({ file_path: path.join(workspace, 'proof.txt'), content: 'ONE_EXTERNAL_WRITE' }),
  } }] };
} });
let adapter, gateway;
try {
  adapter = await createAdapter({ stateRoot, isolated: true, providers: { fixture: {
    package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
    models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } },
  } } });
  const token = randomBytes(32).toString('base64url');
  const alias = modelAlias('fixture/probe');
  const model = { key: 'fixture/probe', target: { providerID: 'fixture', id: 'probe' }, alias, name: 'Fixture', supported: true, free: true, context: 200000, output: 8192 };
  gateway = await createGateway({ adapter, token, mappings: { [alias]: model.target }, models: [model] });
  await writeFile(path.join(workspace, 'gateway.key'), token, { mode: 0o600 });
  await writeFile(path.join(workspace, 'service.json'), JSON.stringify({ url: gateway.url, instance: gateway.instance, pid: process.pid }), { mode: 0o600 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'run', 'claude', '--model', model.key, '--', '-p', 'Write ONE_EXTERNAL_WRITE to proof.txt, then reply READY.',
    '--tools', 'Write', '--allowedTools', 'Write', '--setting-sources', '', '--no-session-persistence', '--max-turns', '3'], {
    cwd: workspace, windowsHide: true, env: { ...process.env,
      OPENCODE_CLAUDE_HOME: workspace,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      DISABLE_AUTOUPDATER: '1', MAX_THINKING_TOKENS: '0', CLAUDE_CODE_DISABLE_THINKING: '1', CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1', ENABLE_TOOL_SEARCH: 'false',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timeout = setTimeout(() => child.kill(), 90000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  clearTimeout(timeout);
  assert.equal(code, 0, output.replaceAll(token, '[redacted]').slice(-3000));
  assert.match(output, /READY/);
  assert.equal(await readFile(path.join(workspace, 'proof.txt'), 'utf8'), 'ONE_EXTERNAL_WRITE');
  assert.equal(resultsConsumed, 1, 'Exactly one Claude tool result reached the model');
  assert.equal((await fixture.status()).calls.length, 0, 'OpenCode must execute no tools');
} finally { await gateway?.close(); await adapter?.close(); await fixture.close(); }
console.log('PASS: real Claude Code -> gateway -> real OpenCode -> fixture -> one Claude Write -> tool result -> READY');
