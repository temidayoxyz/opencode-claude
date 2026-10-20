import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
  async function close(): Promise<void> {
    closing = true;
    for (const current of active.values()) current.controller.abort();
    await runtime?.stop();
    await new Promise<void>((resolve) => {
      broker.close(() => resolve());
      broker.closeAllConnections();
    });
  }
  try {
    const address = broker.address();
    if (!address || typeof address === 'string') throw new Error('No local adapter address');
    const endpoint = `http://127.0.0.1:${address.port}`;
    await mkdir(options.stateRoot, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(path.join(options.stateRoot, 'adapter-'));
    const plugin = path.join(root, 'plugin');
    await mkdir(plugin, { mode: 0o700 });
    await writeFile(path.join(plugin, 'package.json'), '{"type":"module"}', { mode: 0o600 });
    await writeFile(path.join(plugin, 'server.js'), `export { default } from ${JSON.stringify(new URL('./plugin.js', import.meta.url).href)};\n`, { mode: 0o600 });
    runtime = await launchRuntime({
      stateRoot: root,
      ...(options.isolated === undefined ? {} : { isolated: options.isolated }),
      ...(options.nativeBinary === undefined ? {} : { nativeBinary: options.nativeBinary }),
      config: {
        ...(options.providers === undefined ? {} : { providers: options.providers }),
        plugins: [{ package: pathToFileURL(plugin).href, options: { endpoint, token } }],
      },
    });
    const engine = runtime;
    return {
      models: () => engine.api('GET', '/api/model'), close,
      async generate(source, target, consume, signal) {
        if (closing) throw new Error('The local adapter is closing');
        if (active.size >= 8) throw new Error('The local adapter is busy');
        const parsed = parseMessagesRequest(source);
        const directory = await mkdtemp(path.join(engine.workspace, 'request-'));
        const controller = new AbortController();
        const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
        combined.throwIfAborted();
        const current: ActiveRequest = { source, consume, frames: 0, controller };
        active.set(key(directory), current);
        try {
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
          active.delete(key(directory));
          if (current.sessionID) await engine.api('DELETE', `/api/session/${current.sessionID}`).catch(() => {});
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
