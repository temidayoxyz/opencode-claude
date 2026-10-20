import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { OpenCode } from '@opencode/client';
import { launchRuntime } from '../dist/opencode/runtime.js';
import { createSessionBackend } from '../dist/opencode/sessions.js';
import { createGateway } from '../dist/gateway/server.js';
import { modelAlias } from '../dist/config/models.js';

if (!process.argv.includes('--fixture')) throw new Error('This check requires --fixture and never calls a hosted model');
const stateRoot = fileURLToPath(new URL('../.runtime/', import.meta.url));
await mkdir(stateRoot, { recursive: true, mode: 0o700 });
const workspace = await mkdtemp(path.join(stateRoot, 'claude-check-'));
let resultsConsumed = 0;
const fixture = await createFixture({ reply(body) {
  const result = body.messages.findLast(m => m.role === 'tool');
  if (result) {
    assert.match(JSON.stringify(result.content), /file|success|written/i);
    resultsConsumed++;
    return { role: 'assistant', content: 'READY' };
  }
  if (!body.tools?.some(t => t.function.name === 'write')) return { role: 'assistant', content: 'READY' };
  return { role: 'assistant', content: null, tool_calls: [{ id: 'call_fixture_write', type: 'function', function: {
    name: 'write', arguments: JSON.stringify({ path: path.join(workspace, 'proof.txt'), content: 'ONE_NATIVE_WRITE' }),
  } }] };
} });
let adapter, gateway, runtime;
try {
  runtime = await launchRuntime({ stateRoot, isolated: true, permissionMode: 'allow', config: { providers: { fixture: {
    package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
    models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } },
  } } } });
  adapter = createSessionBackend(OpenCode.make(runtime.connection));
  const token = randomBytes(32).toString('base64url');
  const alias = modelAlias('fixture/probe');
  const model = { key: 'fixture/probe', target: { providerID: 'fixture', id: 'probe' }, alias, name: 'Fixture', supported: true, free: true, context: 200000, output: 8192 };
  gateway = await createGateway({ sessions: adapter, token, mappings: { [alias]: model.target }, models: [model] });
  await writeFile(path.join(workspace, 'gateway.key'), token, { mode: 0o600 });
  await writeFile(path.join(workspace, 'service.json'), JSON.stringify({ url: gateway.url, instance: gateway.instance, pid: process.pid }), { mode: 0o600 });
  const claudeConfig = path.join(workspace, 'claude-user');
  await mkdir(claudeConfig);
  await writeFile(path.join(claudeConfig, 'settings.json'), JSON.stringify({ env: {
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_API_KEY: 'fixture-conflicting-key', ANTHROPIC_AUTH_TOKEN: 'fixture-conflicting-token',
  } }), { mode: 0o600 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'run', 'claude', '--model', model.key, '--', '-p', 'Write ONE_NATIVE_WRITE to proof.txt, then reply READY.',
    '--setting-sources', 'user', '--no-session-persistence', '--max-turns', '3'], {
    cwd: workspace, windowsHide: true, env: { ...process.env,
      OPENCODE_CLAUDE_HOME: workspace,
      CLAUDE_CONFIG_DIR: claudeConfig, CLAUDE_CODE_MAX_RETRIES: '0',
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
  assert.equal(await readFile(path.join(workspace, 'proof.txt'), 'utf8'), 'ONE_NATIVE_WRITE');
  assert.equal(resultsConsumed, 1, 'Exactly one OpenCode tool result reached the model');
} finally { await gateway?.close(); await adapter?.close(); await runtime?.stop(); await fixture.close(); }
console.log('PASS: real Claude Code interface -> gateway -> genuine OpenCode agent -> one native Write -> tool result -> READY');
process.exit(0);
