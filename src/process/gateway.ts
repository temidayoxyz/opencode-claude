import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { open, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJSON, localToken, readJSON } from '../config/store.js';
import { catalog, type CatalogModel } from '../config/models.js';
import { createSessionBackend } from '../opencode/sessions.js';
import { connectOpenCode } from '../opencode/connection.js';
import { clientRegistry, type ClientContext } from '../gateway/clients.js';
import { createGateway } from '../gateway/server.js';

interface Service { url: string; instance: string; pid: number }
export interface Connection extends Service { token: string }
function service(value: unknown): Service {
  if (!value || typeof value !== 'object') throw new Error('Invalid gateway state');
  const state = value as Service;
  const url = new URL(state.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !/^[a-f0-9]{32}$/.test(state.instance)
    || !Number.isSafeInteger(state.pid) || state.pid < 1) throw new Error('Invalid gateway state');
  return state;
}
export async function localRequest(connection: Connection, endpoint: string, method = 'GET'): Promise<unknown> {
  const response = await fetch(connection.url + endpoint, { method, redirect: 'error',
    headers: { authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Local gateway returned ${response.status}`);
  return response.json() as Promise<unknown>;
}
async function current(root: string, token: string): Promise<Connection | undefined> {
  let value: unknown;
  try { value = await readJSON(path.join(root, 'service.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('Invalid service.json; move it aside while the gateway is stopped'); }
  const connection = { ...service(value), token };
  try {
    const health = await localRequest(connection, '/health') as { application?: string; instance?: string; pid?: number };
    if (health.application !== 'opencode-claude' || health.instance !== connection.instance || health.pid !== connection.pid) throw new Error('Ownership mismatch');
    return connection;
  } catch { return; }
}
export async function ensureGateway(root: string): Promise<Connection> {
  const token = await localToken(root);
  const running = await current(root, token);
  if (running) return running;
  const lockPath = path.join(root, 'start.lock');
  let lock;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { lock = await open(lockPath, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const available = await current(root, token);
      if (available) return available;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 60000) await unlink(lockPath);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await delay(250);
    }
  }
  if (!lock) throw new Error('Another gateway startup is in progress. Retry in a moment.');
  try {
    const existing = await current(root, token);
    if (existing) return existing;
    await unlink(path.join(root, 'startup-error.json')).catch(() => {});
    const child = spawn(process.execPath, [fileURLToPath(new URL('../cli.js', import.meta.url)), '_serve', root], {
      detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
    });
    let spawnError = false;
    child.once('error', () => { spawnError = true; });
    child.unref();
    for (let attempt = 0; attempt < 120; attempt++) {
      const ready = await current(root, token);
      if (ready) return ready;
      if (spawnError) throw new Error('Cannot start the gateway worker');
      try {
        const failure = await readJSON(path.join(root, 'startup-error.json')) as { error?: unknown };
        throw new Error(typeof failure.error === 'string' ? failure.error : 'Gateway startup failed');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await delay(250);
    }
    throw new Error('Gateway startup timed out. Run opencode-claude doctor.');
  } finally { await lock.close(); await unlink(lockPath).catch(() => {}); }
}
export async function stopGateway(root: string): Promise<boolean> {
  const connection = await current(root, await localToken(root));
  if (!connection) return false;
  await localRequest(connection, '/_shutdown', 'POST');
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await readJSON(path.join(root, 'service.json')) as Service).instance !== connection.instance) return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
    await delay(100);
  }
  throw new Error('Gateway shutdown has not finished. No unrelated process was terminated.');
}
export async function gatewayModels(connection: Connection): Promise<CatalogModel[]> {
  return await localRequest(connection, '/_catalog') as CatalogModel[];
}
export async function registerClient(connection: Connection, model: CatalogModel, kind: ClientContext['kind'], directory = process.cwd()): Promise<Connection> {
  const response = await fetch(connection.url + '/_clients', { method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ directory: path.resolve(directory), model: model.key, kind }) });
  if (!response.ok) throw new Error('Cannot register this workspace with the local gateway');
  const result = await response.json() as { token?: string };
  if (!result.token || !/^[a-zA-Z0-9_-]{43}$/.test(result.token)) throw new Error('Invalid gateway client registration');
  return { ...connection, token: result.token };
}
export async function serve(root: string): Promise<void> {
  let adapter: ReturnType<typeof createSessionBackend> | undefined;
  let gateway: Awaited<ReturnType<typeof createGateway>> | undefined;
  const instance = randomBytes(16).toString('hex');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await gateway?.close();
    await adapter?.close();
    const filename = path.join(root, 'service.json');
    try { if ((await readJSON(filename) as Service).instance === instance) await unlink(filename); } catch { /* Already removed or replaced. */ }
  };
  try {
    const token = await localToken(root);
    adapter = createSessionBackend(await connectOpenCode());
    const models = catalog(await adapter.models());
    const mappings = Object.fromEntries(models.filter(model => model.supported).flatMap(model => [[model.key, model.target], [model.alias, model.target]]));
    gateway = await createGateway({ sessions: adapter, clients: await clientRegistry(path.join(root, 'clients.json')), token, instance, mappings, models,
      shutdown: () => { void stop().then(() => process.exit(0), () => process.exit(1)); } });
    await atomicJSON(path.join(root, 'service.json'), { url: gateway.url, instance, pid: process.pid });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().then(() => process.exit(0), () => process.exit(1)); });
  } catch (cause) {
    await stop();
    // Startup has no model prompt. Only known prerequisite errors are retained.
    const message = cause instanceof Error && /OpenCode .*unverified|requires 2\.0\.32|Install OpenCode|Cannot execute|OpenCode service is unavailable/.test(cause.message)
      ? cause.message : 'Gateway startup failed. Check OpenCode 2.0.32 and the provider configuration.';
    await atomicJSON(path.join(root, 'startup-error.json'), { error: message });
    process.exitCode = 1;
  }
}
