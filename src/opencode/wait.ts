import type { NativeClient } from './connection.js';

// Native wait sends no response headers until the agent is idle. Node fetch
// expires a single headerless request after five minutes. Renew the read-only
// observation before that deadline; never resubmit prompts or interrupt tools.
export async function waitForSession(client: NativeClient, sessionID: string, signal: AbortSignal, leaseMs = 60_000): Promise<void> {
  for (;;) {
    signal.throwIfAborted();
    const lease = new AbortController();
    const timer = setTimeout(() => lease.abort(), leaseMs);
    try {
      await client.session.wait({ sessionID }, { signal: AbortSignal.any([signal, lease.signal]) });
      signal.throwIfAborted();
      if (!lease.signal.aborted) return;
    } catch (cause) {
      signal.throwIfAborted();
      if (!lease.signal.aborted) throw cause;
    } finally { clearTimeout(timer); }
  }
}
