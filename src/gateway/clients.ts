import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, readJSON } from '../config/store.js';
import { RequestError } from './messages.js';

export interface ClientContext { id: string; directory: string; kind: 'claude' | 'desktop' | 'smoke'; model: string }
interface Entry { hash: string; context: ClientContext; expires: number }
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function clientRegistry(filename?: string) {
  let entries: Entry[] = [];
  if (filename) {
    try {
      const stored = await readJSON(filename);
      if (!Array.isArray(stored) || stored.some(e => !e || typeof e.hash !== 'string' || !/^[a-f0-9]{64}$/.test(e.hash)
        || !e.context || typeof e.context.id !== 'string' || typeof e.context.directory !== 'string'
        || !path.isAbsolute(e.context.directory) || !['claude', 'desktop', 'smoke'].includes(e.context.kind)
        || typeof e.context.model !== 'string' || !Number.isFinite(e.expires))) throw new Error('Invalid clients state');
      entries = stored as Entry[];
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  }
  let saving = Promise.resolve();
  return {
    authenticate(token: string | undefined): ClientContext | undefined {
      if (!token || token.length > 256) return;
      return entries.find(e => e.expires > Date.now() && e.hash === hash(token))?.context;
    },
    async register(value: unknown): Promise<{ token: string }> {
      const input = value as Partial<ClientContext> | null;
      if (!input || typeof input.directory !== 'string' || !path.isAbsolute(input.directory)
        || !['claude', 'desktop', 'smoke'].includes(input.kind ?? '') || typeof input.model !== 'string'
        || input.model.length > 256) throw new RequestError('Invalid local client registration');
      const directory = await realpath(input.directory);
      if (!(await stat(directory)).isDirectory()) throw new RequestError('Workspace must be an existing directory');
      entries = entries.filter(e => e.expires > Date.now());
      if (entries.length >= 512) throw new RequestError('Too many registered clients; remove expired client state while the gateway is stopped');
      const token = randomBytes(32).toString('base64url');
      const context: ClientContext = { id: randomUUID(), directory, kind: input.kind!, model: input.model };
      entries.push({ hash: hash(token), context, expires: Date.now() + (input.kind === 'desktop' ? 365 : 7) * 86400000 });
      if (filename) {
        const snapshot = structuredClone(entries);
        saving = saving.then(() => atomicJSON(filename, snapshot));
        await saving;
      }
      return { token };
    },
  };
}
export type ClientRegistry = Awaited<ReturnType<typeof clientRegistry>>;
