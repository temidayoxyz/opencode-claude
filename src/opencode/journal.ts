import { stat } from 'node:fs/promises';
import type { PermissionRequest, FormInfo } from '@opencode/client';
import { atomicJSON, readJSON } from '../config/store.js';
import { ACCESS_REASONS, type AccessReason } from './access.js';

export interface Pending { code: string; permission?: PermissionRequest; form?: FormInfo }
export interface Reply { text: string; usage: { input_tokens: number; output_tokens: number } }
export interface JournalState {
  version: 1;
  conversations: { sessionID: string; seen: string[]; tip?: string; pending?: Pending; blocked: boolean }[];
  requests: { key: string; reply?: Reply; failure?: true; providerError?: { status: number; reason: AccessReason } }[];
}
export interface SessionJournal { initial: JournalState; save(state: JournalState): Promise<void> }
const hash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const id = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 256;
function validate(value: unknown): JournalState {
  const s = value as JournalState | null;
  if (!s || s.version !== 1 || !Array.isArray(s.conversations) || s.conversations.length > 256
    || !Array.isArray(s.requests) || s.requests.length > 2048) throw new Error('Invalid session journal');
  for (const c of s.conversations) {
    if (!c || !id(c.sessionID) || typeof c.blocked !== 'boolean' || (c.tip !== undefined && !hash(c.tip))
      || !Array.isArray(c.seen) || c.seen.length > 65536 || !c.seen.every(id)
      || (c.pending && (!/^[A-F0-9]{12}$/.test(c.pending.code)
        || (!id(c.pending.permission?.id) && !id(c.pending.form?.id))))) throw new Error('Invalid session journal');
  }
  for (const r of s.requests) {
    if (!r || !hash(r.key) || (r.failure !== undefined && r.failure !== true)
      || (!r.reply && !r.failure) || (r.reply && (typeof r.reply.text !== 'string'
        || Buffer.byteLength(r.reply.text) > 8 * 1024 * 1024 || !r.reply.usage
        || ![r.reply.usage.input_tokens, r.reply.usage.output_tokens].every(n => Number.isSafeInteger(n) && n >= 0)))
      || (r.providerError && (!Number.isInteger(r.providerError.status)
        || !ACCESS_REASONS.includes(r.providerError.reason)))) throw new Error('Invalid session journal');
  }
  return s;
}

// Only hashes identify frontend histories. Replies and pending permissions are
// private user data; this file belongs in the external state directory.
export async function openSessionJournal(filename: string): Promise<SessionJournal> {
  let initial: JournalState = { version: 1, conversations: [], requests: [] };
  try {
    if ((await stat(filename)).size > 72 * 1024 * 1024) throw new Error('Session journal is too large');
    initial = validate(await readJSON(filename));
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  let saving = Promise.resolve();
  return { initial, save(state) {
    const snapshot = structuredClone(state);
    if (Buffer.byteLength(JSON.stringify(snapshot, null, 2)) > 72 * 1024 * 1024) return Promise.reject(new Error('Session journal is too large'));
    // Preserve submission order across independent conversations. A failed
    // disk write keeps subsequent operations closed until restart/repair.
    saving = saving.then(() => atomicJSON(filename, snapshot));
    return saving;
  } };
}
