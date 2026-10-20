// SSE framing is independent of the provider's JSON protocol.
// https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
export async function* readSSE(
  body: ReadableStream<Uint8Array>, maxEventSize = 1024 * 1024,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let data: string[] = [];
  let dataLength = 0;
  try {
    let done = false;
    while (!done) {
      const next = await reader.read();
      done = next.done;
      buffer += done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      while (true) {
        const match = /[\r\n]/.exec(buffer);
        if (!match) break;
        const end = match.index;
        if (!done && buffer[end] === '\r' && end === buffer.length - 1) break;
        const width = buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + width);
        if (!line) {
          if (data.length) yield data.join('\n');
          data = [];
          dataLength = 0;
        } else if (line.startsWith('data:')) {
          let value = line.slice(5);
          if (value.startsWith(' ')) value = value.slice(1);
          dataLength += value.length + 1;
          if (dataLength > maxEventSize) throw new Error('SSE event exceeds the size limit');
          data.push(value);
        } else if (line === 'data') {
          data.push('');
          dataLength++;
        }
      }
      if (buffer.length + dataLength > maxEventSize) throw new Error('SSE event exceeds the size limit');
    }
    if (buffer || data.length) throw new Error('Truncated SSE event');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
