import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, link, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface Settings { version: 1; defaultModel?: string }
export function stateDirectory(): string {
  return path.resolve(process.env.OPENCODE_CLAUDE_HOME ?? (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData/Local'), 'opencode-claude')
    : path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), '.local/state'), 'opencode-claude')));
}
export async function atomicJSON(filename: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, filename);
}
export async function readJSON(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8')) as unknown;
}
export async function settings(root: string): Promise<Settings> {
  try {
    const value = await readJSON(path.join(root, 'settings.json')) as Settings;
    if (value.version !== 1 || (value.defaultModel !== undefined && typeof value.defaultModel !== 'string')) throw new Error('Invalid settings.json');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 };
    throw error;
  }
}
export async function localToken(root: string): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const filename = path.join(root, 'gateway.key');
  const temporary = path.join(root, `key-${randomUUID()}.tmp`);
  await writeFile(temporary, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  try {
    // Hard-linking a fully written file is an atomic, non-overwriting creation.
    await link(temporary, filename);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  finally { await unlink(temporary); }
  const token = await readFile(filename, 'utf8');
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new Error('Invalid gateway.key; restore it from backup or remove it while the gateway is stopped');
  return token;
}
