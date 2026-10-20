export const ACCESS_REASONS = ['unknown', 'client_only', 'network', 'region'] as const;
export type AccessReason = (typeof ACCESS_REASONS)[number];
export class ProviderError extends Error {
  readonly status: number;
  readonly reason: AccessReason;
  constructor(status: number, reason: AccessReason = 'unknown') {
    super(`Provider returned ${status}; restriction=${reason}`);
    this.status = status;
    this.reason = reason;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function accessReason(value: unknown): AccessReason {
  const root = object(value);
  const error = root.error === undefined ? root : object(root.error);
  const message = typeof error.message === 'string' ? error.message : '';
  if (/abusive traffic|abuse.{0,80}(?:network|\bIP\b)|current network/i.test(message)) return 'network';
  if (error.type === 'RegionError' || /not available in your (?:region|country)|region.{0,30}not supported/i.test(message)) return 'region';
  if (/free tier.{0,80}only.{0,40}(?:within|inside) OpenCode/i.test(message)) return 'client_only';
  return 'unknown';
}
// Retain only a recognized category. Never relay/log a provider body or URL.
export async function responseAccessReason(response: Response): Promise<AccessReason> {
  const reader = response.clone().body?.getReader();
  if (!reader) return 'unknown';
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 3000);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) return 'unknown';
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return accessReason(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } catch { return 'unknown'; }
  finally {
    clearTimeout(timeout);
    // A cloned body is a tee; awaiting cancel before the native client reads
    // its original branch can deadlock. Cancel without delaying that reader.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
