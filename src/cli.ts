#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { stateDirectory, settings, atomicJSON, readJSON } from './config/store.js';
import { selectModel } from './config/models.js';
import { ensureGateway, gatewayModels, serve, stopGateway } from './process/gateway.js';
import { claudeBinary, launchClaude } from './claude-code/launch.js';
import { launchDesktop } from './claude-desktop/launch.js';
import { restoreProfile, exportProfile } from './claude-desktop/profile.js';
import { providerFailure } from './gateway/server.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string };
const args = process.argv.slice(2);
const root = stateDirectory();
const help = `${manifest.name} ${manifest.version} (experimental)

Usage:
  opencode-claude setup
  opencode-claude models [--free] [--json]
  opencode-claude model set <provider/model>
  opencode-claude run claude [--model <provider/model>] [-- <claude arguments>]
  opencode-claude run desktop [--model <provider/model>]
  opencode-claude desktop export [--model <provider/model>]
  opencode-claude desktop restore
  opencode-claude start | stop | doctor
  opencode-claude smoke --model <provider/model>

Requires Node 24+ and OpenCode 2.0.32. Connect providers in OpenCode first.
Catalog availability does not guarantee access. Free-model restrictions still apply.
Desktop automatic setup: Windows 2.42304.2.0; other versions export a profile.
Distribution: GitHub only; npm registry publication is disabled.`;

function requestedModel(values: string[]): string | undefined {
  if (!values.length) return;
  if (values.length !== 2 || values[0] !== '--model' || !values[1]) throw new Error('Expected --model <provider/model>');
  return values[1];
}
async function main(): Promise<void> {
  if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) { console.log(help); return; }
  if (args.length === 1 && args[0] === '--version') { console.log(`${manifest.name} ${manifest.version}`); return; }
  if (args[0] === '_serve' && args.length === 2 && args[1]) { await serve(path.resolve(args[1])); return; }
  if (args[0] === 'stop' && args.length === 1) { console.log(await stopGateway(root) ? 'Gateway stopped.' : 'No authenticated opencode-claude gateway is running.'); return; }
  if (args[0] === 'desktop' && args[1] === 'restore' && args.length === 2) {
    console.log(await restoreProfile(root) ? 'Previous Desktop profile restored. Reopen Desktop when your work is saved.' : 'No active OpenCode profile needs restoring.'); return;
  }
  const command = args[0];
  if (!['setup', 'models', 'model', 'run', 'desktop', 'start', 'doctor', 'smoke'].includes(command!)) throw new Error('Unknown command. Run opencode-claude --help.');
  if (['setup', 'start', 'doctor'].includes(command!) && args.length !== 1) throw new Error('Unexpected command arguments');
  if (command === 'models' && args.slice(1).some(arg => !['--free', '--json'].includes(arg))) throw new Error('Expected models [--free] [--json]');
  if (command === 'model' && (args[1] !== 'set' || args.length !== 3)) throw new Error('Expected model set <provider/model>');
  if (command === 'run' && !['claude', 'desktop'].includes(args[1]!)) throw new Error('Expected run claude or run desktop');
  if (command === 'desktop' && args[1] !== 'export') throw new Error('Expected desktop export or desktop restore');
  const separator = args.indexOf('--');
  const options = args.slice(2, separator < 0 ? undefined : separator);
  const forwarded = separator < 0 ? [] : args.slice(separator + 1);
  let override: string | undefined;
  if (command === 'run' || command === 'desktop') override = requestedModel(options);
  if (command === 'smoke') {
    override = requestedModel(args.slice(1));
    if (!override) throw new Error('smoke requires an explicit --model; it may consume provider credits');
  }
  if (forwarded.length && !(command === 'run' && args[1] === 'claude')) throw new Error('Forwarded arguments are only supported for run claude');
  const connection = await ensureGateway(root);
  if (command === 'start') { console.log(`Gateway ready at ${connection.url}`); return; }
  const models = await gatewayModels(connection);
  if (command === 'setup') {
    const saved = await settings(root);
    if (saved.defaultModel && !models.some(model => model.key === saved.defaultModel && model.supported)) {
      delete saved.defaultModel;
      console.log('The previous default is no longer available in the current catalog. Select a model from models.');
    }
    const recommended = models.find(model => model.key === 'opencode/minimax-m3.1-flash-free' && model.supported);
    if (!saved.defaultModel && recommended) saved.defaultModel = recommended.key;
    await atomicJSON(path.join(root, 'settings.json'), saved);
    console.log(`Setup complete. State: ${root}\nDefault: ${saved.defaultModel ?? 'choose with model set'}\nNo provider request was made. Run opencode-claude models to see available choices.`);
    return;
  }
  if (command === 'models') {
    const selected = models.filter(model => !args.includes('--free') || model.free);
    if (args.includes('--json')) console.log(JSON.stringify(selected, null, 2));
    else {
      for (const model of selected) console.log(`${model.supported ? 'protocol OK' : 'unsupported'}\t${model.free ? 'listed free' : 'check pricing'}\t${model.key}`);
      console.log('\nCatalog and protocol status only; access is unverified until a smoke test passes.');
    }
    return;
  }
  if (command === 'doctor') {
    console.log(`Node: ${process.version}\nOpenCode: 2.0.32 (verified runtime contract)\nGateway: healthy (${connection.url})\nCatalog: ${models.length} models, ${models.filter(model => model.supported).length} supported text/tool routes\nState: ${root}`);
    const saved = await settings(root);
    try { console.log(`Default model: ${selectModel(models, saved.defaultModel).key}`); }
    catch { console.log('Default model: missing or unavailable; run models, then model set <provider/model>.'); }
    try {
      const version = spawnSync(claudeBinary(), ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      console.log(version.status === 0 ? `Claude Code: ${version.stdout.trim()}` : 'Claude Code: cannot execute');
    } catch { console.log('Claude Code: missing; install it or set CLAUDE_BIN'); }
    try { console.log(`Last opt-in access check: ${JSON.stringify(await readJSON(path.join(root, 'access-check.json')))}`); }
    catch { console.log('Live model access: unverified. No hosted inference is performed by doctor.'); }
    console.log('Desktop chat and Code require separate UI checks. Reasoning blocks, images and server tools are not supported.');
    return;
  }
  const saved = await settings(root);
  const model = selectModel(models, command === 'model' ? args[2] : override ?? saved.defaultModel);
  if (command === 'model') {
    await atomicJSON(path.join(root, 'settings.json'), { ...saved, defaultModel: model.key });
    console.log(`Default model: ${model.key}`); return;
  }
  if (command === 'run' && args[1] === 'claude') {
    console.error(`Using ${model.key} through local OpenCode. Provider pricing and access rules apply.`);
    process.exitCode = await launchClaude(connection, model, forwarded); return;
  }
  if (command === 'desktop') { console.log(`Profile exported: ${await exportProfile(root, connection, model)}`); return; }
  if (command === 'run') { console.log(await launchDesktop(root, connection, model)); return; }
  if (command === 'smoke') {
    let result = 'failed';
    let failure: string | undefined;
    try {
      const response = await fetch(connection.url + '/v1/messages', { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-api-key': connection.token }, signal: AbortSignal.timeout(150000),
        body: JSON.stringify({ model: model.alias, max_tokens: 32, messages: [{ role: 'user', content: 'Reply only READY.' }] }) });
      const value = await response.json() as { content?: { type: string; text?: string }[]; error?: { message?: string } };
      if (!response.ok) failure = value.error?.message ?? 'Generation failed';
      else if (!value.content?.some(block => block.type === 'text' && block.text?.includes('READY'))) failure = 'The model returned no expected READY response';
      else result = 'passed (text only)';
    } catch (cause) { failure = providerFailure(cause); }
    await atomicJSON(path.join(root, 'access-check.json'), { model: model.key, checkedAt: new Date().toISOString(), result, ...(failure ? { reason: failure } : {}) });
    console.log(`${model.key}: ${result}${failure ? `\n${failure}` : ''}`);
    if (failure) process.exitCode = 1;
  }
}
await main().catch(cause => { console.error(cause instanceof Error ? cause.message : 'Command failed'); process.exitCode = 1; });
