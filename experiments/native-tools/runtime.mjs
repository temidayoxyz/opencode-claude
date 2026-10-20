import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function startRuntime(fixture) {
  const project = fileURLToPath(new URL('../../', import.meta.url));
  const native = process.env.OPENCODE_CLAUDE_BIN ?? (process.platform === 'win32'
    ? path.join(process.env.APPDATA, 'npm/node_modules/@opencode/cli/bin/opencode.exe')
    : 'opencode');
  const inspected = spawnSync(native, ['--version'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  if (inspected.error || inspected.status !== 0) throw new Error('Cannot execute the installed OpenCode binary');
  const version = inspected.stdout.trim().replace(/^opencode v/, '');
  if (version !== '2.0.32') throw new Error(`This experiment targets OpenCode 2.0.32; found ${version}`);

  const parent = path.join(project, '.runtime');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(parent, 'native-tools-'));
  const workspace = path.join(root, 'workspace');
  for (const directory of ['workspace', 'config', 'plugin', 'data', 'cache', 'state', 'home']) {
    await mkdir(path.join(root, directory), { mode: 0o700 });
  }
  const password = randomBytes(32).toString('base64url');
  const pluginSource = pathToFileURL(fileURLToPath(new URL('plugin.mjs', import.meta.url))).href;
  await writeFile(path.join(root, 'plugin/package.json'), '{"type":"module"}', { mode: 0o600 });
  await writeFile(path.join(root, 'plugin/server.js'), `export { default } from ${JSON.stringify(pluginSource)};\n`, { mode: 0o600 });
  const configuration = {
    update: 'disable', share: 'disabled', snapshots: false,
    warming: false, model: 'fixture/probe',
    permissions: [{ action: '*', resource: '*', effect: 'deny' },
      { action: 'external_counter', resource: '*', effect: 'allow' }],
    plugins: [{ package: pathToFileURL(path.join(root, 'plugin')).href,
      options: { endpoint: fixture.url, token: fixture.token } }],
    providers: {
      fixture: {
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
        models: { probe: {
          name: 'Local deterministic fixture',
          capabilities: { tools: true, input: ['text'], output: ['text'] },
          limit: { context: 131072, output: 4096 },
        } },
      },
    },
  };
  await writeFile(path.join(root, 'config/opencode.json'), JSON.stringify(configuration), { mode: 0o600 });
  const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP',
    'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PROGRAMDATA', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'LC_ALL']);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  Object.assign(environment, {
    OPENCODE_PASSWORD: password, OPENCODE_DB: path.join(root, 'opencode.db'),
    OPENCODE_CONFIG_DIR: path.join(root, 'config'), OPENCODE_TEST_HOME: path.join(root, 'home'),
    OPENCODE_CONFIG_PROJECT_DISABLE: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_FILEWATCHER_DISABLE: '1', OPENCODE_DISABLE_FFF: '1',
    XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
  });
  const child = spawn(native, ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: workspace, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let logs = '';
  let stdout = '';
  const redact = (text) => text.replaceAll(password, '[redacted]').replaceAll(fixture.token, '[redacted]');
  child.stderr.on('data', (chunk) => { logs = (logs + redact(chunk.toString())).slice(-8000); });
  async function stop() {
    if (!child.pid) return;
    child.stdin.end();
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      const stopped = await Promise.race([exited.then(() => true), delay(3000).then(() => false)]);
      if (stopped) break;
      child.kill(signal);
    }
    await Promise.race([exited, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      throw new Error('The owned experiment process did not exit');
    }
  }
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Runtime startup timed out: ${logs}`)), 20000);
      const fail = (error) => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', () => fail(new Error(`Runtime exited during startup: ${logs}`)));
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split('\n')) {
          try {
            const parsed = JSON.parse(line);
            const candidate = new URL(parsed.url);
            if (candidate.protocol !== 'http:' || candidate.hostname !== '127.0.0.1'
              || candidate.username || candidate.password) throw new Error('Invalid runtime address');
            clearTimeout(timeout);
            resolve(candidate.origin);
            return;
          } catch { /* Non-address startup output is not a readiness signal. */ }
        }
      });
    });
    return {
      version, workspace,
      async api(method, endpoint, body) {
        const response = await fetch(url + endpoint, {
          method, redirect: 'error', signal: AbortSignal.timeout(25000),
          headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
            'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(redact(`OpenCode ${method} ${endpoint}: ${response.status} ${text}\n${logs}`));
        return text ? JSON.parse(text) : undefined;
      },
      diagnostics: () => logs, stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
