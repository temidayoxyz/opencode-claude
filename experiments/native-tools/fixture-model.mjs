import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

// Original local fixture, not a proxy to an external model service.
export async function createFixture(options = {}) {
  const token = randomBytes(32).toString('base64url');
  const calls = new Map();
  const captures = new Map();
  let ready = false;
  let modelRequests = 0;
  let lastModelStream = false;
  let customContextReceived = false;
  const respond = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  async function json(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('Fixture input exceeds 1 MiB');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  }
  const server = createServer(async (req, res) => {
    if (req.headers.origin) return respond(res, 403, { error: 'browser_origin_rejected' });
    if (req.headers.authorization !== `Bearer ${token}`) {
      return respond(res, 401, { error: 'unauthorized' });
    }
    try {
      const route = new URL(req.url, 'http://127.0.0.1').pathname;
      if (req.method === 'POST' && route === '/bridge/ready') {
        ready = true;
        return respond(res, 200, { ready });
      }
      if (req.method === 'GET' && route === '/bridge/status') {
        return respond(res, 200, snapshot());
      }
      if (req.method === 'POST' && route === '/bridge/capture') {
        const capture = await json(req);
        if (typeof capture.sessionID !== 'string' || !Array.isArray(capture.body?.choices)) {
          return respond(res, 400, { error: 'invalid_fixture_capture' });
        }
        captures.set(capture.sessionID, capture.body);
        return respond(res, 200, { accepted: true });
      }
      if (req.method === 'POST' && route === '/bridge/call') {
        const call = await json(req);
        if (typeof call.sessionID !== 'string' || typeof call.callID !== 'string'
          || call.name !== 'external_counter' || call.input?.delta !== 1) {
          return respond(res, 400, { error: 'invalid_fixture_call' });
        }
        const key = `${call.sessionID}:${call.callID}`;
        if (calls.has(key)) return respond(res, 409, { error: 'duplicate_call' });
        const record = { ...call, key, state: 'pending', res };
        calls.set(key, record);
        res.once('close', () => {
          if (record.state === 'pending') record.state = 'cancelled';
        });
        // Leave this response open until the external harness supplies a result.
        return;
      }
      if (req.method === 'POST' && route.startsWith('/bridge/result/')) {
        const key = decodeURIComponent(route.slice('/bridge/result/'.length));
        const call = calls.get(key);
        if (!call || call.state !== 'pending') {
          return respond(res, 409, { error: 'call_is_not_pending' });
        }
        const result = await json(req);
        if (result.value !== 1) return respond(res, 400, { error: 'invalid_fixture_result' });
        call.state = 'completed';
        respond(call.res, 200, result);
        return respond(res, 200, { accepted: true });
      }
      if (req.method === 'POST' && route === '/v1/chat/completions') {
        const body = await json(req);
        modelRequests++;
        lastModelStream = Boolean(body.stream);
        customContextReceived = JSON.stringify(body.messages).includes('FIXTURE_CONTEXT_MARKER')
          && body.messages.some((message) => message.role === 'assistant' && message.content === 'Fixture previous reply');
        const hasCounter = body.tools?.some((tool) => tool.function?.name === 'external_counter');
        const result = body.messages?.findLast((message) => message.role === 'tool');
        const content = typeof result?.content === 'string'
          ? result.content : JSON.stringify(result?.content);
        const consumed = result && /"value"\s*:\s*1/.test(content ?? '');
        if (result && !consumed && !options.reply) throw new Error('Unexpected external tool result');
        const toolCalls = hasCounter && !result ? [{
          id: `call_fixture_${modelRequests}`, type: 'function',
          function: { name: 'external_counter', arguments: '{"delta":1}' },
        }] : undefined;
        const controller = new AbortController();
        res.once('close', () => controller.abort());
        const message = options.reply ? await options.reply(body, { signal: controller.signal }) : toolCalls
          ? { role: 'assistant', content: null, tool_calls: toolCalls }
          : { role: 'assistant', content: consumed ? 'EXTERNAL_COUNTER=1' : 'Fixture title' };
        const actualCalls = message.tool_calls;
        const finish = actualCalls ? 'tool_calls' : 'stop';
        const common = { id: `chatcmpl_fixture_${modelRequests}`, created: 1, model: 'probe' };
        const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
        if (!body.stream) return respond(res, 200, {
          ...common, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }], usage,
        });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const delta = actualCalls
          ? { role: 'assistant', tool_calls: actualCalls.map((call, index) => ({ index, ...call })) }
          : message;
        for (const [part, reason] of [[delta, null], [{}, finish]]) {
          res.write(`data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: part, finish_reason: reason }], ...(reason ? { usage } : {}),
          })}\n\n`);
        }
        res.end('data: [DONE]\n\n');
        return;
      }
      respond(res, 404, { error: 'not_found' });
    } catch (error) {
      respond(res, 500, { error: String(error.message).replaceAll(token, '[redacted]') });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  function snapshot() {
    return { ready, modelRequests, lastModelStream, customContextReceived,
      calls: [...calls.values()].map(({ res, ...call }) => ({ ...call })) };
  }
  async function sendResult(key, result) {
    return fetch(`${url}/bridge/result/${encodeURIComponent(key)}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(result), signal: AbortSignal.timeout(5000), redirect: 'error',
    });
  }
  return {
    url, token, status: async () => snapshot(), captured: async (id) => captures.get(id),
    result: async (key, value) => {
      const response = await sendResult(key, value);
      if (!response.ok) throw new Error(`Fixture result rejected: ${response.status}`);
    },
    duplicateResultStatus: async (key) => (await sendResult(key, { value: 1 })).status,
    close: async () => {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}
