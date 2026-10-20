import { parseMessagesRequest, type ParsedMessages } from '../gateway/messages.js';
import { readSSE } from './sse.js';
import { responseAccessReason } from './access.js';

// A versioned projection of the public Promise plugin contracts. No SDK runtime
// package is needed: https://github.com/anomalyco/opencode/tree/v2.0.32/packages/plugin/src/promise
interface Definition {
  name: string; description: string; input: Record<string, unknown>;
  options: { codemode: false };
  execute(): Promise<never>;
}
interface Editor { list(): readonly { id: string }[]; remove(id: string): void; add(tool: Definition): void }
interface GenerateEvent {
  system: ParsedMessages['system']; messages: ParsedMessages['messages']; options: Record<string, unknown>;
}
interface ResponseEvent { kind: string; sessionID: string; request: Request; response: Response }
interface Context {
  options: Record<string, unknown>;
  location: { directory: string };
  tool: { transform(edit: (editor: Editor) => void): Promise<unknown> };
  session: {
    hook(name: 'generate', callback: (event: GenerateEvent) => Promise<void>): Promise<unknown>;
    hook(name: 'http.response', callback: (event: ResponseEvent) => Promise<void>): Promise<unknown>;
  };
}

export default {
  id: 'opencode-claude.messages',
  async setup(context: Context): Promise<void> {
    if (typeof context.options.endpoint !== 'string' || typeof context.options.token !== 'string') {
      throw new Error('Missing local adapter connection');
    }
    const endpoint = new URL(context.options.endpoint);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1'
      || endpoint.username || endpoint.password || endpoint.pathname !== '/') throw new Error('Invalid local adapter endpoint');
    const headers = { authorization: `Bearer ${context.options.token}`, 'content-type': 'application/json' };
    const directory = context.location.directory;
    async function input(): Promise<ParsedMessages> {
      const response = await fetch(new URL(`/request?directory=${encodeURIComponent(directory)}`, endpoint), {
        headers, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Local request is unavailable: ${response.status}`);
      return parseMessagesRequest(await response.json());
    }
    const tools = (await input()).tools;
    await context.tool.transform((editor) => {
      for (const item of editor.list()) editor.remove(item.id);
      for (const tool of tools) editor.add({
        ...tool, options: { codemode: false },
        async execute(): Promise<never> { throw new Error('Claude owns tool execution; transient generation must not execute tools'); },
      });
    });
    await context.session.hook('generate', async (event) => {
      const request = await input();
      event.system = request.system;
      event.messages = request.messages;
      Object.assign(event.options, request.options);
    });
    await context.session.hook('http.response', async (event) => {
      if (event.kind !== 'generate') return;
      if (!event.response.ok) {
        const reason = event.response.status === 403 ? await responseAccessReason(event.response) : 'unknown';
        const accepted = await fetch(new URL('/failure', endpoint), {
          method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ directory, sessionID: event.sessionID, status: event.response.status, reason }),
        });
        await accepted.arrayBuffer();
        if (!accepted.ok) throw new Error(`Local status consumer stopped: ${accepted.status}`);
        return;
      }
      if (!new URL(event.request.url).pathname.endsWith('/chat/completions')) {
        throw new Error('This adapter currently requires the OpenAI Chat Completions wire protocol');
      }
      const response = event.response.clone();
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('The current adapter requires a streamed Chat Completions response');
      }
      for await (const data of readSSE(response.body)) {
        if (data.trim() === '[DONE]') continue;
        const accepted = await fetch(new URL('/frame', endpoint), {
          method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ directory, sessionID: event.sessionID, frame: JSON.parse(data) as unknown }),
        });
        await accepted.arrayBuffer();
        if (!accepted.ok) throw new Error(`Local response consumer stopped: ${accepted.status}`);
      }
    });
  },
};
