import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeBinary } from './runtime.js';

export type NativeClient = ReturnType<typeof OpenCode.make>;

// Attach exactly as a normal OpenCode client. In particular, do not rewrite
// provider requests, override permissions, or replace an existing service.
export async function connectOpenCode(): Promise<NativeClient> {
  let endpoint = await Service.discover({ version: '2.0.32' });
  if (!endpoint) {
    if (await Service.discover()) throw new Error('OpenCode service version is unverified; this release requires 2.0.32');
    const child = spawn(nativeBinary(), ['serve', '--service'], {
      detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new Error('Cannot execute OpenCode. Install OpenCode 2.0.32.')));
    });
    child.unref();
    for (let i = 0; i < 80 && !endpoint; i++) {
      await delay(250);
      endpoint = await Service.discover({ version: '2.0.32' });
    }
  }
  if (!endpoint) throw new Error('OpenCode service is unavailable. Open OpenCode 2.0.32, then retry.');
  const url = new URL(endpoint.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('OpenCode service must be local');
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers({ url: endpoint.url, ...(endpoint.auth ? { auth: endpoint.auth } : {}) }) });
}
