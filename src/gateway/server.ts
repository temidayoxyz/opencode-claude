import { timingSafeEqual, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { OpenCodeAdapter, ModelTarget } from '../opencode/adapter.js';
import { parseMessagesRequest, RequestError } from './messages.js';
import { MessageStream } from './stream.js';

export interface GatewayOptions {
  adapter: OpenCodeAdapter;
  token: string;
  mappings: Record<string, ModelTarget>;
  models?: unknown;
  port?: number;
  instance?: string;
  shutdown?: () => void;
}
function matches(received: string | undefined, expected: string): boolean {
  const a = Buffer.from(received ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
function error(response: ServerResponse, status: number, message: string): void {
  json(response, status, { type: 'error', error: { type: status === 400 ? 'invalid_request_error' : 'api_error', message } });
}
async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > 8 * 1024 * 1024) throw new RequestError('Request exceeds 8 MiB');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new RequestError('Invalid JSON'); }
}
// Error bodies never include a raw upstream payload, local prompt, or credential.
export function providerFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (/403|FreeTierError|abusive|not available.*network/i.test(message)) return 'OpenCode/provider denied access. Check eligibility or network restrictions in OpenCode; no fallback was used.';
  if (/429|rate.?limit|quota/i.test(message)) return 'OpenCode/provider rate limit reached. Wait and retry; no fallback was used.';
  if (/401|credential|unauthorized/i.test(message)) return 'OpenCode/provider authentication failed. Connect the provider in OpenCode.';
  if (/timeout|timed out|abort/i.test(message)) return 'Generation timed out or was cancelled.';
  return 'OpenCode generation failed or returned an unsupported response. Check the selected model in OpenCode.';
}
export async function createGateway(options: GatewayOptions) {
  const instance = options.instance ?? randomBytes(16).toString('hex');
  const controllers = new Set<AbortController>();
  const server = createServer(async (request, response) => {
    if (request.headers.origin) return error(response, 403, 'Browser-origin requests are disabled');
    const credential = request.headers['x-api-key'];
    if (!matches(request.headers.authorization, `Bearer ${options.token}`)
      && !matches(typeof credential === 'string' ? credential : undefined, options.token)) return error(response, 401, 'Invalid local gateway credential');
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { application: 'opencode-claude', instance, pid: process.pid });
    if (request.method === 'GET' && url.pathname === '/_catalog') return json(response, 200, options.models ?? []);
    if (request.method === 'POST' && url.pathname === '/_shutdown' && options.shutdown) {
      json(response, 200, { stopping: true });
      setImmediate(options.shutdown);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') return json(response, 200, {
      data: Object.keys(options.mappings).map((id) => ({ id, type: 'model', display_name: id, created_at: '2026-10-20T00:00:00Z' })), has_more: false,
    });
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') return error(response, 404, 'Unsupported endpoint');
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 180000);
    let ping: NodeJS.Timeout | undefined;
    response.once('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const source = await body(request);
      const parsed = parseMessagesRequest(source);
      const target = Object.hasOwn(options.mappings, parsed.model) ? options.mappings[parsed.model] : undefined;
      if (!target) throw new RequestError('Unknown model mapping; select a model with opencode-claude');
      const write = async (type: string, data: unknown) => {
        controller.signal.throwIfAborted();
        if (!response.headersSent) response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        if (!response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)) {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => { response.off('drain', drained); response.off('close', closed); };
            const drained = () => { cleanup(); resolve(); };
            const closed = () => { cleanup(); reject(new Error('Client disconnected')); };
            response.once('drain', drained); response.once('close', closed);
          });
        }
      };
      if (parsed.stream) {
        // Flush early and keep slow eligible providers alive. No synthetic model tokens.
        await write('ping', { type: 'ping' });
        ping = setInterval(() => { if (!response.destroyed && !response.writableNeedDrain) response.write('event: ping\ndata: {"type":"ping"}\n\n'); }, 15000);
      }
      const stream = new MessageStream(parsed.model, parsed.tools.map((tool) => tool.name), parsed.stream ? write : undefined);
      await options.adapter.generate(source, target, (frame) => stream.frame(frame), controller.signal);
      const result = await stream.finish();
      if (parsed.stream) response.end(); else json(response, 200, result);
    } catch (cause) {
      request.resume();
      if (!response.destroyed) {
        const message = cause instanceof RequestError ? cause.message : providerFailure(cause);
        if (response.headersSent) response.end(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message } })}\n\n`);
        else error(response, cause instanceof RequestError ? 400 : 502, message);
      }
    } finally {
      clearTimeout(timeout); clearInterval(ping); controllers.delete(controller);
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No gateway address');
  return { url: `http://127.0.0.1:${address.port}`, instance, async close() {
    for (const controller of controllers) controller.abort();
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
  } };
}
