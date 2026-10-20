import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, readJSON } from '../config/store.js';
import type { CatalogModel } from '../config/models.js';
import type { Connection } from '../process/gateway.js';

interface Meta { appliedId?: string; entries: { id: string; name: string }[]; [key: string]: unknown }
interface Ownership { id: string; library: string; previousId?: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function desktopProfile(connection: Connection, model: CatalogModel) {
  return { inferenceProvider: 'gateway', inferenceCredentialKind: 'static',
    inferenceGatewayBaseUrl: connection.url, inferenceGatewayApiKey: connection.token,
    chatTabEnabled: true, modelDiscoveryEnabled: false,
    inferenceModels: [{ name: model.alias, labelOverride: `${model.name} (OpenCode)`, anthropicFamilyTier: 'sonnet', isFamilyDefault: true }],
  };
}
function metadata(value: unknown): Meta {
  const meta = value as Meta;
  if (!meta || !Array.isArray(meta.entries) || meta.entries.some(entry => !uuid.test(entry.id) || typeof entry.name !== 'string')
    || (meta.appliedId !== undefined && !uuid.test(meta.appliedId)) || meta.hybridPointer) throw new Error('Unsupported Desktop configuration metadata; use the exported profile');
  return meta;
}
export async function exportProfile(root: string, connection: Connection, model: CatalogModel): Promise<string> {
  const filename = path.join(root, 'desktop-profile.json');
  await atomicJSON(filename, desktopProfile(connection, model));
  return filename;
}
export async function applyProfile(root: string, library: string, connection: Connection, model: CatalogModel) {
  await mkdir(library, { recursive: true, mode: 0o700 });
  const metaPath = path.join(library, '_meta.json');
  let meta: Meta;
  try { meta = metadata(await readJSON(metaPath)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    meta = { entries: [] };
  }
  const ownerPath = path.join(root, 'desktop.json');
  let owner: Ownership | undefined;
  try {
    owner = await readJSON(ownerPath) as Ownership;
    if (!uuid.test(owner.id) || path.resolve(owner.library) !== path.resolve(library)) throw new Error('Desktop profile ownership changed; use the exported profile');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const id = owner?.id ?? randomUUID();
  const ownProfile = path.join(library, `${id}.json`);
  const backup = path.join(root, 'backups', `desktop-${Date.now()}-${randomUUID()}`);
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await copyFile(metaPath, path.join(backup, '_meta.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const previousId = meta.appliedId === id ? owner?.previousId : meta.appliedId;
  await atomicJSON(ownerPath, { id, library, ...(previousId ? { previousId } : {}) });
  await atomicJSON(ownProfile, desktopProfile(connection, model));
  const entries = meta.entries.filter(entry => entry.id !== id);
  entries.push({ id, name: 'OpenCode' });
  await atomicJSON(metaPath, { ...meta, entries, appliedId: id });
  return { id, backup };
}
export async function restoreProfile(root: string): Promise<boolean> {
  let owner: Ownership;
  try { owner = await readJSON(path.join(root, 'desktop.json')) as Ownership; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  if (!uuid.test(owner.id) || (owner.previousId && !uuid.test(owner.previousId))) throw new Error('Invalid Desktop ownership record');
  const filename = path.join(owner.library, '_meta.json');
  const meta = metadata(await readJSON(filename));
  if (meta.appliedId !== owner.id) return false;
  const next = { ...meta };
  if (owner.previousId && meta.entries.some(entry => entry.id === owner.previousId)) next.appliedId = owner.previousId;
  else delete next.appliedId;
  await atomicJSON(filename, next);
  return true;
}
