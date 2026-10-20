import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { V2Event } from '@opencode/client';
import type { SessionJournal, Pending, Reply } from './journal.js';
import type { NativeClient } from './connection.js';
import type { ModelTarget } from './adapter.js';
import { accessReason, ProviderError } from './access.js';
import { RequestError, type ParsedMessages, type ModelMessage } from '../gateway/messages.js';
import type { ClientContext } from '../gateway/clients.js';

interface Usage { input_tokens: number; output_tokens: number }
export interface SessionSink { text(delta: string): Promise<void>; complete(usage: Usage): void }
interface Conversation { sessionID: string; busy: boolean; pending?: Pending; seen: Set<string>; tip?: string; recovery?: boolean; inFlight?: Cached }
interface Cached { reply?: Reply; failure?: true; busy?: true; providerError?: ProviderError }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const zeroUsage = () => ({ input_tokens: 0, output_tokens: 0 });

export interface SessionBackend {
  models(): Promise<unknown>;
  respond(source: ParsedMessages, target: ModelTarget, context: ClientContext, sink: SessionSink, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

// Genuine agent sessions: OpenCode owns its instructions, history, provider
// protocol and tools. Claude receives text, never executable copies of tools
// that OpenCode has already run.
export function createSessionBackend(client: NativeClient, options: { events?: boolean; journal?: SessionJournal } = {}): SessionBackend {
  const continuations = new Map<string, Conversation>();
  const requests = new Map<string, Cached>();
  const owned = new Set<Conversation>();
  const listeners = new Map<string, (event: V2Event) => void>();
  const eventsAbort = new AbortController();
  let closed = false;
  let cachedBytes = 0;
  let active = 0;
  let eventLoop: Promise<void> | undefined;
  for (const saved of options.journal?.initial.conversations ?? []) {
    const session: Conversation = { sessionID: saved.sessionID, busy: false, seen: new Set(saved.seen),
      recovery: saved.blocked, ...(saved.tip ? { tip: saved.tip } : {}), ...(saved.pending ? { pending: saved.pending } : {}) };
    owned.add(session);
    if (session.tip) continuations.set(session.tip, session);
  }
  for (const { key, providerError, ...saved } of options.journal?.initial.requests ?? []) {
    requests.set(key, { ...saved, ...(providerError ? { providerError: new ProviderError(providerError.status, providerError.reason) } : {}) });
    cachedBytes += Buffer.byteLength(saved.reply?.text ?? '');
  }
  const persist = async () => {
    if (!options.journal) return;
    await options.journal.save({ version: 1,
      conversations: [...owned].map(s => ({ sessionID: s.sessionID, seen: [...s.seen],
        blocked: !!s.recovery || !!s.inFlight?.busy, ...(s.tip ? { tip: s.tip } : {}), ...(s.pending ? { pending: s.pending } : {}) })),
      requests: [...requests].map(([key, c]) => ({ key, ...(c.reply ? { reply: c.reply } : {}),
        ...(c.failure || c.busy ? { failure: true as const } : {}),
        ...(c.providerError ? { providerError: { status: c.providerError.status, reason: c.providerError.reason } } : {}) })),
    });
  };
  if (options.events !== false) {
    eventLoop = (async () => {
      // SharedEvents reconnects; final context reconciliation also recovers
      // missed text. Only events belonging to our own sessions are observed.
      for await (const event of client.event.subscribe({ signal: eventsAbort.signal })) {
        if ('data' in event && event.data && typeof event.data === 'object' && 'sessionID' in event.data
          && typeof event.data.sessionID === 'string') listeners.get(event.data.sessionID)?.(event);
      }
    })().catch(() => { /* A completed context remains the authoritative result. */ });
  }
  return {
    async models() { return client.model.list(); },
    async respond(source, target, context, sink, signal) {
      if (closed) throw new RequestError('Gateway is stopping');
      if (`${target.providerID}/${target.id}` !== context.model) throw new RequestError('Model differs from this client registration; launch again with the desired model');
      if (source.messages.some(m => m.role === 'tool' || m.content.some(p => p.type !== 'text'))) throw new RequestError('Native session mode accepts text conversations; start a new conversation');
      const history = source.messages;
      const latest = history.at(-1);
      if (!latest || latest.role !== 'user') throw new RequestError('Native sessions require a final user message');
      const prompt = latest.content.map(p => p.type === 'text' ? p.text : '').join('\n');
      if (!prompt.trim()) throw new RequestError('A nonempty user prompt is required');
      const namespace = [context.id, source.userId ?? '', context.model];
      const key = digest([namespace, history]);
      const cached = requests.get(key);
      if (cached?.busy) throw new RequestError('This request is already running; wait for it to finish', 409);
      if (cached?.providerError) throw cached.providerError;
      if (cached?.failure) throw new RequestError('The previous attempt failed or was interrupted. Actions may have run; inspect the OpenCode session before sending a new prompt', 409);
      if (cached?.reply) { await sink.text(cached.reply.text); sink.complete(cached.reply.usage); return; }
      if (requests.size >= 2048) throw new RequestError('Session cache is full; finish current work and restart the gateway');
      if (cachedBytes > 56 * 1024 * 1024) throw new RequestError('Reply cache is full; finish current work and restart the gateway');
      let conversation = continuations.get(digest([namespace, history.slice(0, -1)]));
      if (!conversation && history.length > 1) throw new RequestError('Conversation history is unknown. Start a new conversation; the original session remains in OpenCode. Histories from versions before 0.2.0-dev.2 cannot be restored', 409);
      if (conversation?.recovery) throw new RequestError('The OpenCode session was interrupted. Inspect it in OpenCode before starting a new conversation; actions will not be replayed', 409);
      if (conversation?.busy) throw new RequestError('This OpenCode session is already running', 409);
      if (active >= 8) throw new RequestError('Eight OpenCode sessions are already active; wait for one to finish');
      if (!conversation && owned.size + active >= 256) throw new RequestError('Too many sessions; finish current work and restart the gateway');
      const cache: Cached = { busy: true };
      requests.set(key, cache); // Reserve before the first asynchronous mutation.
      active++;
      if (!conversation) {
        try {
          await persist(); // Reserve durably before creating/submitting native work.
          const info = await client.session.create({ title: 'opencode-claude', model: target, location: { directory: context.directory } }, { signal });
          conversation = { sessionID: info.id, busy: false, seen: new Set() };
          owned.add(conversation);
        } catch (cause) {
          active--; cache.failure = true; delete cache.busy;
          if (signal.aborted) requests.delete(key); // No prompt was submitted.
          await persist();
          throw cause;
        }
      }
      const session = conversation;
      session.busy = true;
      session.inFlight = cache;
      let text = '';
      let size = 0;
      const usage = zeroUsage();
      let writes = Promise.resolve();
      let writeError: unknown;
      let toolActivity = false;
      const streamed = new Map<string, string>();
      const eventIds = new Set<string>();
      const progress = new Set<string>();
      const append = (delta: string) => {
        if (!delta) return;
        size += Buffer.byteLength(delta);
        if (size > 8 * 1024 * 1024) throw new Error('Native session output exceeds the limit');
        text += delta;
        writes = writes.then(() => sink.text(delta)).catch(cause => { writeError = cause; });
      };
      let interrupting: Promise<void> | undefined;
      const interrupt = () => interrupting ??= client.session.interrupt({ sessionID: session.sessionID },
        { signal: AbortSignal.timeout(5000) }).then(() => {});
      const interrupted = () => { void interrupt().catch(() => {}); };
      signal.addEventListener('abort', interrupted, { once: true });
      try {
        signal.throwIfAborted();
        if (closed) throw new RequestError('Gateway is stopping');
        await persist(); // A crash after this point must not replay actions.
        // Set a baseline before resuming a blocked tool. Its assistant message
        // can have been partially streamed in the preceding frontend turn.
        for (const message of await client.session.context({ sessionID: session.sessionID }, { signal })) {
          if (message.type === 'assistant') streamed.set(message.id,
            message.content.filter(part => part.type === 'text').map(part => part.text).join(''));
        }
        listeners.set(session.sessionID, event => {
          try {
            if (eventIds.has(event.id)) return;
            if (eventIds.size >= 65536) throw new Error('Native session event limit exceeded');
            eventIds.add(event.id);
            if (/^session\.(tool|shell|compaction)\./.test(event.type)) toolActivity = true;
            if (event.type === 'session.text.delta') {
              const k = event.data.assistantMessageID;
              streamed.set(k, (streamed.get(k) ?? '') + event.data.delta);
              append(event.data.delta);
            } else if (event.type === 'session.tool.input.started' && !progress.has(event.data.id)) {
              progress.add(event.data.id);
              append(`\n[OpenCode tool: ${event.data.name}]\n`);
            }
          } catch (cause) { writeError = cause; interrupted(); }
        });
        let answered = false;
        if (session.pending) {
          const pending = session.pending;
          const approval = /^(approve|reject) ([A-F0-9]{12})\s*$/.exec(prompt.trim());
          const answer = /^answer ([A-F0-9]{12}) (\{[\s\S]*\})\s*$/.exec(prompt.trim());
          if ((approval?.[2] ?? answer?.[1]) === pending.code) {
            if (pending.permission && approval) {
              await client.permission.reply({ sessionID: session.sessionID, requestID: pending.permission.id,
                decision: approval[1] === 'approve' ? 'once' : 'reject' }, { signal });
              answered = true;
            } else if (pending.form && approval?.[1] === 'reject') {
              await client.session.form.cancel({ sessionID: session.sessionID, formID: pending.form.id }, { signal });
              answered = true;
            } else if (pending.form && answer) {
              let value: Record<string, string | number | boolean | string[]>;
              try { value = JSON.parse(answer[2]!) as typeof value; }
              catch { throw new RequestError('Answer must be a JSON object'); }
              if (!value || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string' && typeof v !== 'boolean'
                && !(typeof v === 'number' && Number.isFinite(v)) && !(Array.isArray(v) && v.every(s => typeof s === 'string')))) throw new RequestError('Unsupported form answer');
              await client.session.form.reply({ sessionID: session.sessionID, formID: pending.form.id, answer: value }, { signal });
              answered = true;
            }
          }
          if (answered) delete session.pending;
        } else {
          await client.session.prompt({ sessionID: session.sessionID, text: prompt }, { signal });
          answered = true;
        }
        if (answered) {
          const waitAbort = new AbortController();
          const waitSignal = AbortSignal.any([signal, waitAbort.signal]);
          let idle = false;
          let waitError: unknown;
          const waiting = client.session.wait({ sessionID: session.sessionID }, { signal: waitSignal })
            .then(() => { idle = true; }, cause => { if (!waitAbort.signal.aborted) waitError = cause; });
          try {
            while (!idle) {
              signal.throwIfAborted();
              if (writeError) throw writeError;
              if (waitError) throw waitError;
              const permissions = await client.permission.list({ sessionID: session.sessionID }, { signal });
              const forms = await client.session.form.list({ sessionID: session.sessionID }, { signal });
              if (permissions[0] || forms[0]) {
                session.pending = { code: randomBytes(6).toString('hex').toUpperCase(),
                  ...(permissions[0] ? { permission: permissions[0] } : { form: forms[0]! }) };
                break;
              }
              await Promise.race([waiting, delay(250, undefined, { signal })]);
            }
          } finally { waitAbort.abort(); await waiting; }
        }
        listeners.delete(session.sessionID);
        const messages = await client.session.context({ sessionID: session.sessionID }, { signal });
        for (const message of messages) {
          if (message.type !== 'assistant' || session.seen.has(message.id)) continue;
          if (message.error) throw new ProviderError(message.error.status ?? 502, accessReason(message.error));
          // Text ordinals count text parts, whereas context indexes also
          // include reasoning and tools. Reconcile visible text per message.
          const fullText = message.content.filter(part => part.type === 'text').map(part => part.text).join('');
          const previous = streamed.get(message.id) ?? '';
          if (!fullText.startsWith(previous)) throw new Error('OpenCode text stream disagrees with completed context');
          append(fullText.slice(previous.length));
          for (const part of message.content) {
            if (part.type === 'tool' && !progress.has(part.id)) append(`\n[OpenCode tool: ${part.name}]\n`);
          }
          if (message.time?.completed) session.seen.add(message.id);
          if (message.tokens) {
            usage.input_tokens += message.tokens.input + message.tokens.cache.read + message.tokens.cache.write;
            usage.output_tokens += message.tokens.output;
          }
        }
        if (session.pending) {
          const { code, permission, form } = session.pending;
          append(permission
            ? `\nOpenCode needs permission in ${context.directory}:\n${permission.action}\n${JSON.stringify(permission.resources)}\nReply exactly: approve ${code}\nOr: reject ${code}`
            : `\nOpenCode needs an answer: ${form!.title}\n${JSON.stringify(form!.fields)}\nReply: answer ${code} {"field":"value"}\nOr: reject ${code}`);
        } else {
          const info = await client.session.get({ sessionID: session.sessionID }, { signal });
          if (info.outcome === 'failed' || info.outcome === 'interrupted') throw new Error('OpenCode execution failed or was interrupted');
          if (!text) append('OpenCode completed this turn without a text response.');
        }
        await writes;
        if (writeError) throw writeError;
        signal.throwIfAborted();
        cache.reply = { text, usage };
        cachedBytes += size;
        delete cache.busy;
        const response: ModelMessage = { role: 'assistant', content: [{ type: 'text', text }] };
        if (session.tip) continuations.delete(session.tip);
        session.tip = digest([namespace, [...history, response]]);
        continuations.set(session.tip, session);
        await persist();
        sink.complete(usage);
      } catch (cause) {
        delete cache.reply;
        cache.failure = true;
        session.recovery = true;
        delete cache.busy;
        if (cause instanceof ProviderError) cache.providerError = cause;
        let stopped = false;
        // Do not poison recurring Desktop checks when a client cancels an
        // initial text request. Only retry after verified idle and no actions.
        if (!(cause instanceof RequestError)) {
          try { await interrupt(); stopped = true; } catch { /* Unknown completion stays protected. */ }
        }
        if (signal.aborted && !(cause instanceof ProviderError) && history.length === 1 && !session.pending && !toolActivity && stopped) {
          try {
            const verification = { signal: AbortSignal.timeout(5000) };
            await client.session.wait({ sessionID: session.sessionID }, verification);
            const completed = await client.session.context({ sessionID: session.sessionID }, verification);
            const noActions = completed.every(message => message.type !== 'shell' && !message.type.startsWith('compaction')
              && (message.type !== 'assistant' || message.content.every(part => part.type !== 'tool')));
            if (noActions && !toolActivity) { requests.delete(key); owned.delete(session); }
          } catch { /* Without proof, preserve protection against duplicate actions. */ }
        }
        await persist();
        throw cause;
      } finally {
        listeners.delete(session.sessionID);
        session.busy = false;
        active--;
        signal.removeEventListener('abort', interrupted);
      }
    },
    async close() {
      closed = true;
      eventsAbort.abort();
      for (const session of owned) if (session.busy || session.pending) session.recovery = true;
      let journalError: unknown;
      const saved = persist().catch(cause => { journalError = cause; });
      await Promise.allSettled([...owned].filter(s => s.busy || s.pending).map(s =>
        client.session.interrupt({ sessionID: s.sessionID }, { signal: AbortSignal.timeout(5000) })));
      await saved;
      await eventLoop;
      if (journalError) throw journalError;
      // The normal OpenCode service and saved conversations belong to the user.
    },
  };
}
