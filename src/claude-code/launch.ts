import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { CatalogModel } from '../config/models.js';
import type { Connection } from '../process/gateway.js';

export function claudeBinary(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const native = path.join(homedir(), '.local/bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  if (existsSync(native)) return native;
  if (process.platform !== 'win32') return 'claude';
  const candidate = (process.env.PATH ?? '').split(path.delimiter).map(directory => path.join(directory, 'claude.exe')).find(existsSync);
  if (!candidate) throw new Error('Install the native Claude Code CLI or set CLAUDE_BIN to its executable');
  return candidate;
}
export function launchEnvironment(connection: Connection, model: CatalogModel, original = process.env): NodeJS.ProcessEnv {
  const env = { ...original };
  for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_BETAS', 'ANTHROPIC_FALLBACK_MODEL']) delete env[key];
  Object.assign(env, {
    ANTHROPIC_BASE_URL: connection.url, ANTHROPIC_AUTH_TOKEN: connection.token, ANTHROPIC_API_KEY: connection.token,
    ANTHROPIC_MODEL: model.alias, ANTHROPIC_DEFAULT_SONNET_MODEL: model.alias, ANTHROPIC_DEFAULT_OPUS_MODEL: model.alias,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model.alias, ANTHROPIC_SMALL_FAST_MODEL: model.alias, CLAUDE_CODE_SUBAGENT_MODEL: model.alias,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_THINKING: '1', MAX_THINKING_TOKENS: '0', ENABLE_TOOL_SEARCH: 'false',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(Math.min(8192, model.output)),
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(Math.min(200000, model.context)),
  });
  return env;
}
export async function launchClaude(connection: Connection, model: CatalogModel, args: string[]): Promise<number> {
  if (args.some(arg => /^--(?:model|fallback-model)(?:=|$)/.test(arg))) throw new Error('Select the model before --; forwarded model overrides are unsupported');
  const child = spawn(claudeBinary(), ['--model', model.alias, ...args], {
    env: launchEnvironment(connection, model), stdio: 'inherit', windowsHide: false,
  });
  // The terminal delivers Ctrl+C to both; keep the wrapper alive to report its exit.
  const interrupted = () => {};
  process.on('SIGINT', interrupted);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', () => reject(new Error('Cannot launch Claude Code. Check CLAUDE_BIN.')));
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)));
    });
  } finally { process.off('SIGINT', interrupted); }
}
