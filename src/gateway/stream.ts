import { randomBytes } from 'node:crypto';

type ObjectValue = Record<string, unknown>;
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: ObjectValue };
type Emit = (type: string, data: unknown) => Promise<void>;
interface ToolState { index: number; id: string; name: string; arguments: string }
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model response object');
  return value as ObjectValue;
}

// Native event order: https://platform.claude.com/docs/en/build-with-claude/streaming
export class MessageStream {
  private readonly id = `msg_oc_${randomBytes(12).toString('hex')}`;
  private readonly blocks: Block[] = [];
  private readonly tools = new Map<number, ToolState>();
  private readonly emit: Emit;
  private readonly model: string;
  private readonly names: Set<string>;
  private started = false;
  private ended = false;
  private textIndex: number | undefined;
  private reason: string | undefined;
  private size = 0;
  private usage = { input_tokens: 0, output_tokens: 0 };

  constructor(model: string, tools: string[], emit: Emit = async () => {}) {
    this.model = model;
    this.names = new Set(tools);
    this.emit = emit;
  }
  private async event(type: string, data: ObjectValue): Promise<void> {
    await this.emit(type, { type, ...data });
  }
  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.event('message_start', { message: { id: this.id, type: 'message', role: 'assistant', model: this.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  }
  async frame(value: unknown): Promise<void> {
    if (this.ended) throw new Error('Response already completed');
    const frame = object(value);
    this.size += Buffer.byteLength(JSON.stringify(frame));
    if (this.size > 16 * 1024 * 1024) throw new Error('Model response exceeds the size limit');
    if (frame.error) throw new Error('Provider rejected the generation');
    if (frame.usage) {
      const usage = object(frame.usage);
      for (const [from, to] of [['prompt_tokens', 'input_tokens'], ['completion_tokens', 'output_tokens']] as const) {
        const amount = usage[from];
        if (amount !== undefined) {
          if (!Number.isSafeInteger(amount) || Number(amount) < 0) throw new Error('Invalid model usage');
          this.usage[to] = Number(amount);
        }
      }
    }
    if (!Array.isArray(frame.choices)) throw new Error('Invalid model response choices');
    if (frame.choices.length > 1) throw new Error('Multiple generation choices are unsupported');
    for (const item of frame.choices) {
      const choice = object(item);
      const delta = object(choice.delta ?? {});
      await this.start();
      if (typeof delta.content === 'string' && delta.content) {
        if (this.reason) throw new Error('Content after model finish');
        if (this.textIndex === undefined) {
          if (this.tools.size) throw new Error('Text after tool calls is unsupported');
          this.textIndex = this.blocks.length;
          this.blocks.push({ type: 'text', text: '' });
          await this.event('content_block_start', { index: this.textIndex, content_block: { type: 'text', text: '' } });
        }
        const block = this.blocks[this.textIndex];
        if (block?.type !== 'text') throw new Error('Invalid text state');
        block.text += delta.content;
        await this.event('content_block_delta', { index: this.textIndex, delta: { type: 'text_delta', text: delta.content } });
      }
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls) || this.reason) throw new Error('Invalid tool delta');
        for (const item of delta.tool_calls) {
          const call = object(item);
          if (!Number.isInteger(call.index) || Number(call.index) < 0 || Number(call.index) > 255) throw new Error('Invalid tool index');
          const index = Number(call.index);
          let tool = this.tools.get(index);
          if (!tool) {
            tool = { index: this.blocks.length, id: '', name: '', arguments: '' };
            this.blocks.push({ type: 'tool_use', id: '', name: '', input: {} });
            this.tools.set(index, tool);
          }
          if (call.id !== undefined) {
            if (typeof call.id !== 'string' || !call.id || call.id.length > 256 || (tool.id && tool.id !== call.id)) throw new Error('Invalid tool ID');
            tool.id = call.id;
          }
          const fn = object(call.function ?? {});
          if (fn.name !== undefined) {
            if (typeof fn.name !== 'string' || !this.names.has(fn.name) || (tool.name && tool.name !== fn.name)) throw new Error('Unknown model tool');
            tool.name = fn.name;
          }
          const argumentsDelta = fn.arguments ?? '';
          if (typeof argumentsDelta !== 'string') throw new Error('Invalid tool arguments delta');
          tool.arguments += argumentsDelta;
        }
      }
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        if (this.reason || !['stop', 'length', 'tool_calls'].includes(String(choice.finish_reason))) throw new Error('Unsupported model finish reason');
        this.reason = String(choice.finish_reason);
      }
    }
  }
  async finish() {
    if (this.ended || !this.reason) throw new Error('Missing or duplicate model finish');
    const ids = new Set<string>();
    for (const tool of this.tools.values()) {
      if (!tool.id || !tool.name || ids.has(tool.id)) throw new Error('Incomplete or duplicate tool call');
      ids.add(tool.id);
      let input: ObjectValue;
      try { input = object(JSON.parse(tool.arguments || '{}')); } catch { throw new Error('Invalid completed tool arguments'); }
      this.blocks[tool.index] = { type: 'tool_use', id: tool.id, name: tool.name, input };
    }
    if (this.reason === 'tool_calls' && !this.tools.size) throw new Error('Missing tool calls');
    this.ended = true;
    await this.start();
    // Validate all arguments before exposing any executable call. OpenAI may
    // interleave parallel argument deltas; native blocks are emitted in order.
    for (let index = 0; index < this.blocks.length; index++) {
      const block = this.blocks[index]!;
      if (block.type === 'tool_use') {
        await this.event('content_block_start', { index, content_block: { ...block, input: {} } });
        await this.event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      }
      await this.event('content_block_stop', { index });
    }
    const stop_reason = this.reason === 'length' ? 'max_tokens' : this.tools.size ? 'tool_use' : 'end_turn';
    await this.event('message_delta', { delta: { stop_reason, stop_sequence: null }, usage: this.usage });
    await this.event('message_stop', {});
    return { id: this.id, type: 'message', role: 'assistant', model: this.model, content: this.blocks,
      stop_reason, stop_sequence: null, usage: this.usage };
  }
}
