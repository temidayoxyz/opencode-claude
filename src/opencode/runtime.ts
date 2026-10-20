import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface RuntimeOptions {
  stateRoot: string;
  config: Record<string, unknown>;
  isolated?: boolean;
  nativeBinary?: string;
  permissionMode?: 'deny' | 'ask' | 'allow';
}
export interface RunningRuntime {
  connection: { baseUrl: string; headers: { authorization: string } };
  version: string;
  workspace: string;
  root: string;
  api(method: 'GET' | 'POST' | 'DELETE', endpoint: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
  stop(): Promise<void>;
}

export function nativeBinary(): string {
  if (process.env.OPENCODE_CLAUDE_BIN) return process.env.OPENCODE_CLAUDE_BIN;
  if (process.platform !== 'win32') return 'opencode';
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/@opencode/cli/bin/opencode.exe'),
    path.join(homedir(), '.opencode/bin/opencode.exe'),
    ...(process.env.PATH ?? '').split(path.delimiter).map((directory) => path.join(directory, 'opencode.exe')),
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) throw new Error('Install OpenCode or set OPENCODE_CLAUDE_BIN to its native executable');
  return found;
}

function configSecrets(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === 'string' && /token|password|api.?key/i.test(key)
      ? [item] : configSecrets(item));
}

// Versioned process contract, including --stdio ownership and environment names:
// https://github.com/anomalyco/opencode/blob/v2.0.32/packages/cli/src/server-process.ts
export async function launchRuntime(options: RuntimeOptions): Promise<RunningRuntime> {
  const binary = options.nativeBinary ?? nativeBinary();
  const inspected = spawnSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (inspected.error || inspected.status !== 0) throw new Error('Cannot execute the installed OpenCode binary');
  const version = inspected.stdout.trim().replace(/^opencode v/, '');
  if (version !== '2.0.32') throw new Error(`OpenCode ${version} is unverified; this adapter currently requires 2.0.32`);
  await mkdir(options.stateRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(options.stateRoot, 'engine-'));
  for (const directory of ['workspace', 'config', 'data', 'cache', 'state', 'home']) {
    await mkdir(path.join(root, directory), { mode: 0o700 });
  }
  const workspace = path.join(root, 'workspace');
  const password = randomBytes(32).toString('base64url');
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  const secrets = [password, authorization, ...configSecrets(options.config)].filter(Boolean);
  const redact = (text: string) => secrets.reduce((result, secret) => result.replaceAll(secret, '[redacted]'), text);
  const configPath = path.join(root, 'config/runtime.json');
  await writeFile(configPath, JSON.stringify({ ...options.config, update: 'disable', share: 'disabled',
    snapshots: false, warming: false, permissions: [{ action: '*', resource: '*', effect: options.permissionMode ?? 'deny' }],
  }), { mode: 0o600 });
  const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP',
    'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PROGRAMDATA', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'LANG', 'LC_ALL',
    'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME']);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  Object.assign(environment, {
    OPENCODE_PASSWORD: password, OPENCODE_DB: path.join(root, 'opencode.db'), OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_PROJECT_DISABLE: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_FILEWATCHER_DISABLE: '1', OPENCODE_DISABLE_FFF: '1',
  });
  if (options.isolated) Object.assign(environment, {
    OPENCODE_CONFIG_DIR: path.join(root, 'config'), OPENCODE_TEST_HOME: path.join(root, 'home'),
    OPENCODE_DISABLE_MODELS_FETCH: '1', XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'),
  });
  const child = spawn(binary, ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: workspace, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let logs = '';
  child.stderr.on('data', (chunk: Buffer) => { logs = (logs + redact(chunk.toString())).slice(-8000); });
  child.stdin.on('error', () => {}); // Exit can close stdin before the final cleanup attempt.
  async function stop(): Promise<void> {
    if (!child.pid) return;
    child.stdin.end();
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      const stopped = await Promise.race([exited.then(() => true), delay(3000, undefined, { ref: false }).then(() => false)]);
      if (stopped) break;
      child.kill(signal);
    }
    await Promise.race([exited, delay(3000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null) throw new Error('The owned OpenCode process did not exit');
  }
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`OpenCode startup timed out: ${logs}`)), 20000);
      const fail = (error: Error) => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', () => fail(new Error(`OpenCode exited during startup: ${logs}`)));
      let buffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buffer = (buffer + chunk.toString()).slice(-16384);
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const candidate = new URL((JSON.parse(line) as { url: string }).url);
            if (candidate.protocol !== 'http:' || candidate.hostname !== '127.0.0.1'
              || candidate.username || candidate.password) continue;
            clearTimeout(timeout);
            resolve(candidate.origin);
          } catch { /* Only the native runtime's JSON address line signals readiness. */ }
        }
      });
    });
    return {
      version, workspace, root, stop, connection: { baseUrl: url, headers: { authorization } },
      async api(method, endpoint, body, signal) {
        if (!endpoint.startsWith('/api/') && endpoint !== '/openapi.json') throw new Error('Invalid runtime API path');
        const response = await fetch(url + endpoint, {
          method, redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
          headers: { authorization, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        if (!response.ok) {
          let reason = 'Runtime request failed';
          try {
            const error = JSON.parse(text) as { message?: unknown };
            if (typeof error.message === 'string') reason = error.message.slice(0, 2000);
          } catch { /* Never include an arbitrary HTML/body dump in an error. */ }
          throw new Error(redact(`OpenCode returned ${response.status}: ${reason}`));
        }
        return text ? JSON.parse(text) as unknown : undefined;
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
