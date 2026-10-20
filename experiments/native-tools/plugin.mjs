// Uses the official 2.0.32 Promise plugin and tool registration contracts:
// https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/tool.ts
export default {
  id: 'opencode-claude.native-tools-experiment',
  async setup(context) {
    const endpoint = new URL(context.options.endpoint);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1'
      || endpoint.username || endpoint.password || endpoint.pathname !== '/') {
      throw new Error('The experiment requires a loopback fixture endpoint');
    }
    const headers = {
      authorization: `Bearer ${context.options.token}`,
      'content-type': 'application/json',
    };
    await context.session.hook('http.response', async (event) => {
      if (event.kind !== 'generate' || !event.response.ok) return;
      const text = await event.response.clone().text();
      let body;
      if (event.response.headers.get('content-type')?.includes('text/event-stream')) {
        const message = { role: 'assistant', content: '', tool_calls: [] };
        for (const block of text.split(/\r?\n\r?\n/)) {
          const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') continue;
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) message.content += delta.content;
          for (const call of delta?.tool_calls ?? []) {
            const current = message.tool_calls[call.index] ??= {
              id: call.id, type: 'function', function: { name: '', arguments: '' },
            };
            if (call.id) current.id = call.id;
            current.function.name += call.function?.name ?? '';
            current.function.arguments += call.function?.arguments ?? '';
          }
        }
        body = { choices: [{ message }] };
      } else {
        body = JSON.parse(text);
      }
      const captured = await fetch(new URL('/bridge/capture', endpoint), {
        method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ sessionID: event.sessionID, body }),
      });
      if (!captured.ok) throw new Error('Fixture model-response capture failed');
    });
    await context.tool.transform((editor) => {
      // Fixture-only safety: no built-in file, shell, or browser tool is executable.
      // This does not establish eligibility for any hosted free-model service.
      for (const item of editor.list()) editor.remove(item.id);
      editor.add({
        name: 'external_counter', description: 'Ask the external caller to increment its counter',
        input: {
          type: 'object', properties: { delta: { type: 'integer', const: 1 } },
          required: ['delta'], additionalProperties: false,
        },
        options: { codemode: false, permission: 'external_counter' },
        async execute(input, call) {
          const response = await fetch(new URL('/bridge/call', endpoint), {
            method: 'POST', headers, redirect: 'error',
            signal: AbortSignal.any([call.signal, AbortSignal.timeout(30000)]),
            body: JSON.stringify({
              sessionID: call.sessionID, callID: call.id, name: 'external_counter', input,
            }),
          });
          if (!response.ok) throw new Error(`External caller rejected the tool: ${response.status}`);
          const result = await response.json();
          if (result.value !== 1) throw new Error('Invalid counter result');
          return { content: JSON.stringify(result) };
        },
      });
    });
    const ready = await fetch(new URL('/bridge/ready', endpoint), {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!ready.ok) throw new Error('Fixture ready handshake failed');
  },
};
