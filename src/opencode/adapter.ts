import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, writeFile, rm, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseMessagesRequest } from '../gateway/messages.js';
import { launchRuntime, type RunningRuntime } from './runtime.js';

export interface ModelTarget { providerID: string; id: string }
export interface AdapterOptions {
  stateRoot: string;
  isolated?: boolean;
  nativeBinary?: string;
  providers?: Record<string, unknown>;
}
type Consumer = (frame: unknown) => Promise<void>;
interface ActiveRequest {
  source: unknown;
  sessionID?: string;
  consume: Consumer;
  frames: number;
  controller: AbortController;
}
export interface OpenCodeAdapter {
  generate(source: unknown, target: ModelTarget, consume: Consumer, signal?: AbortSignal): Promise<void>;
  models(): Promise<unknown>;
  close(): Promise<void>;
}

function key(directory: string): string {
  const normalized = path.resolve(directory);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function authorized(value: string | undefined, expected: string): boolean {
  const received = Buffer.from(value ?? '');
  const secret = Buffer.from(expected);
  return received.length === secret.length && timingSafeEqual(received, secret);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local adapter payload');
  return value as Record<string, unknown>;
}
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > 2 * 1024 * 1024) throw new Error('Local event exceeds the size limit');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export async function createAdapter(options: AdapterOptions): Promise<OpenCodeAdapter> {
  const token = randomBytes(32).toString('base64url');
  const active = new Map<string, ActiveRequest>();
  let closing = false;
  let pending = 0;
  const broker = createServer(async (request, response) => {
    if (request.headers.origin) return json(response, 403, { error: 'browser_origin_rejected' });
    if (!authorized(request.headers.authorization, `Bearer ${token}`)) return json(response, 401, { error: 'unauthorized' });
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/request') {
        const directory = url.searchParams.get('directory');
        const current = directory ? active.get(key(directory)) : undefined;
        if (!current || current.controller.signal.aborted) return json(response, 410, { error: 'request_expired' });
        return json(response, 200, current.source);
      }
      if (request.method === 'POST' && url.pathname === '/frame') {
        const event = object(await readBody(request));
        const current = typeof event.directory === 'string' ? active.get(key(event.directory)) : undefined;
        if (!current || current.controller.signal.aborted || current.sessionID !== event.sessionID) {
          return json(response, 410, { error: 'request_expired' });
        }
        await current.consume(event.frame);
        current.frames++;
        return json(response, 200, { accepted: true });
      }
      json(response, 404, { error: 'not_found' });
    } catch {
      json(response, 500, { error: 'local_response_rejected' });
    }
  });
  await new Promise<void>((resolve, reject) => {
    broker.once('error', reject);
    broker.listen(0, '127.0.0.1', resolve);
  });
  let runtime: RunningRuntime | undefined;
  let ownedRoot: string | undefined;
  let ownership: { dev: number; ino: number; parent: string } | undefined;
  let refreshing: Promise<void> | undefined;
  async function close(): Promise<void> {
    closing = true;
    for (const current of active.values()) current.controller.abort();
    await refreshing?.catch(() => {});
    await runtime?.stop();
    await new Promise<void>((resolve) => {
      broker.close(() => resolve());
      broker.closeAllConnections();
    });
    if (ownedRoot && ownership) {
      const info = await lstat(ownedRoot);
      const resolved = await realpath(ownedRoot);
      if (info.isSymbolicLink() || info.dev !== ownership.dev || info.ino !== ownership.ino
        || path.dirname(resolved) !== ownership.parent || !path.basename(resolved).startsWith('adapter-')) throw new Error('Refusing cleanup outside the proven-owned adapter directory');
      await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      ownedRoot = undefined;
    }
  }
  try {
    const address = broker.address();
    if (!address || typeof address === 'string') throw new Error('No local adapter address');
    const endpoint = `http://127.0.0.1:${address.port}`;
    await mkdir(options.stateRoot, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(path.join(options.stateRoot, 'adapter-'));
    const info = await lstat(root);
    ownership = { dev: info.dev, ino: info.ino, parent: await realpath(options.stateRoot) };
    ownedRoot = root;
    const plugin = path.join(root, 'plugin');
    await mkdir(plugin, { mode: 0o700 });
    await writeFile(path.join(plugin, 'package.json'), '{"type":"module"}', { mode: 0o600 });
    await writeFile(path.join(plugin, 'server.js'), `export { default } from ${JSON.stringify(new URL('./plugin.js', import.meta.url).href)};\n`, { mode: 0o600 });
    const runtimeOptions = {
      stateRoot: root,
      ...(options.isolated === undefined ? {} : { isolated: options.isolated }),
      ...(options.nativeBinary === undefined ? {} : { nativeBinary: options.nativeBinary }),
      config: {
        ...(options.providers === undefined ? {} : { providers: options.providers }),
        plugins: [{ package: pathToFileURL(plugin).href, options: { endpoint, token } }],
      },
    };
    runtime = await launchRuntime(runtimeOptions);
    let engine = runtime;
    let completed = 0;
    return {
      models: async () => { await refreshing; return engine.api('GET', '/api/model'); }, close,
      async generate(source, target, consume, signal) {
        if (closing) throw new Error('The local adapter is closing');
        // Location/plugin caches belong to the native engine. Bound their lifetime
        // without changing any mapping or interrupting an active generation.
        if (completed >= 32) {
          if (!refreshing && (active.size || pending)) throw new Error('The local adapter is busy recycling');
          refreshing ??= (async () => {
            await engine.stop();
            runtime = await launchRuntime(runtimeOptions);
            engine = runtime;
            completed = 0;
          })();
          try { await refreshing; } finally { refreshing = undefined; }
        }
        if (closing) throw new Error('The local adapter is closing');
        if (active.size + pending >= 8) throw new Error('The local adapter is busy');
        const parsed = parseMessagesRequest(source);
        pending++;
        let directory: string;
        try { directory = await mkdtemp(path.join(engine.workspace, 'request-')); }
        finally { pending--; }
        if (closing) throw new Error('The local adapter is closing');
        const controller = new AbortController();
        const forwardAbort = () => controller.abort();
        signal?.addEventListener('abort', forwardAbort, { once: true });
        if (signal?.aborted) controller.abort();
        const combined = controller.signal;
        const current: ActiveRequest = { source, consume, frames: 0, controller };
        active.set(key(directory), current);
        try {
          combined.throwIfAborted();
          const created = object(await engine.api('POST', '/api/session', {
            title: 'Transient opencode-claude request', location: { directory }, model: target,
            permissions: [{ action: '*', resource: '*', effect: 'deny' },
              ...parsed.tools.map((tool) => ({ action: tool.name, resource: '*', effect: 'allow' }))],
          }, combined));
          const id = object(created.data).id;
          if (typeof id !== 'string' || !/^ses_[a-zA-Z0-9]+$/.test(id)) throw new Error('Invalid runtime session ID');
          current.sessionID = id;
          await engine.api('POST', `/api/session/${id}/generate`, {
            prompt: 'The external Messages context is supplied by the opencode-claude plugin.',
          }, combined);
          if (!current.frames) throw new Error('The model did not produce a supported HTTP response');
        } finally {
          signal?.removeEventListener('abort', forwardAbort);
          if (current.sessionID) {
            if (combined.aborted) await engine.api('POST', `/api/session/${current.sessionID}/interrupt`, {}).catch(() => {});
            await engine.api('DELETE', `/api/session/${current.sessionID}`).catch(() => {});
          }
          active.delete(key(directory));
          completed++;
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
