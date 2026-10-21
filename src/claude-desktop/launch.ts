import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CatalogModel } from '../config/models.js';
import type { Connection } from '../process/gateway.js';
import { applyProfile, exportProfile } from './profile.js';

export async function launchDesktop(root: string, connection: Connection, model: CatalogModel): Promise<string> {
  const exported = await exportProfile(root, connection, model);
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
    return `Profile exported to ${exported}. Automatic Desktop setup supports checked Windows builds 2.42304.2.0 and 3.1623.0.0; import this profile in a compatible third-party inference configuration.`;
  }
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-AppxPackage -Name Claude | Select-Object -First 1 Version,InstallLocation | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 15000 });
  let app: { Version?: string; InstallLocation?: string };
  try { app = JSON.parse(stdout) as typeof app; } catch { return `Desktop was not found. Profile exported to ${exported}.`; }
  if (!['2.42304.2.0', '3.1623.0.0'].includes(app.Version ?? '') || !app.InstallLocation) return `Desktop ${app.Version ?? 'unknown'} is unverified. Profile exported to ${exported}; existing profiles were preserved.`;
  const applied = await applyProfile(root, path.join(process.env.LOCALAPPDATA, 'Claude-3p/configLibrary'), connection, model);
  const child = spawn(path.join(app.InstallLocation, 'app/Claude.exe'), [], { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('The profile is ready, but Desktop could not be opened'))); });
  child.unref();
  return `OpenCode profile selected for ${model.name}. If Desktop was already running, quit and reopen it when your work is saved. Backup: ${applied.backup}. Restore with: opencode-claude desktop restore`;
}
