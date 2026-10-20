export class RequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

type JsonObject = Record<string, unknown>;
export type ModelPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: JsonObject }
  | { type: 'tool-result'; id: string; name: string; result: { type: 'text' | 'error'; value: string } };
export interface ModelMessage {
  role: 'user' | 'assistant' | 'tool';
  content: ModelPart[];
}
export interface ModelTool { name: string; description: string; input: JsonObject }
export interface ParsedMessages {
  userId?: string;
  model: string;
  stream: boolean;
  system: { type: 'text'; text: string }[];
  messages: ModelMessage[];
  tools: ModelTool[];
  options: Record<string, number | string | string[]>;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(`${label} must be an object`);
  return value as JsonObject;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new RequestError(`${label} must be a string`);
  return value;
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new RequestError(`${label} must be an array with at most ${max} items`);
  return value;
}
function name(value: unknown): string {
  const result = string(value, 'Tool name');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) {
    throw new RequestError('Unsupported tool name');
  }
  return result;
}
function texts(value: unknown, label: string): { type: 'text'; text: string }[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  return list(value, label, 4096).map((item) => {
    const block = object(item, label);
    if (block.type !== 'text') throw new RequestError(`Unsupported ${label} content block`);
    return { type: 'text', text: string(block.text, `${label} text`) };
  });
}

// OpenCode 2.0.32's documented model message representation:
// https://github.com/anomalyco/opencode/blob/v2.0.32/packages/ai/src/schema/messages.ts
export function parseMessagesRequest(value: unknown, mode: 'model' | 'session' = 'model'): ParsedMessages {
  const request = object(value, 'Request');
  const supported = new Set(['model', 'messages', 'system', 'max_tokens', 'stream', 'tools',
    'tool_choice', 'temperature', 'top_p', 'stop_sequences', 'metadata', 'thinking', 'output_config']);
  const unsupported = Object.keys(request).find((key) => !supported.has(key));
  if (unsupported) throw new RequestError(`Unsupported request field: ${JSON.stringify(unsupported).slice(0, 80)}`);
  const model = string(request.model, 'Model');
  if (!model || model.length > 256) throw new RequestError('Invalid model identifier');
  if (!Number.isInteger(request.max_tokens) || Number(request.max_tokens) < 1 || Number(request.max_tokens) > 65536) {
    throw new RequestError('max_tokens must be an integer from 1 to 65536');
  }
  if (request.stream !== undefined && typeof request.stream !== 'boolean') throw new RequestError('stream must be a boolean');
  if (request.thinking !== undefined) {
    const thinking = object(request.thinking, 'thinking');
    if (mode === 'model' ? thinking.type !== 'disabled' : !['disabled', 'enabled', 'adaptive', 'between_tools'].includes(String(thinking.type))) {
      throw new RequestError('Unsupported thinking configuration for this adapter');
    }
    // Native sessions keep OpenCode's own reasoning configuration. Frontend
    // preferences are accepted without rewriting the native provider request.
  }
  if (request.tool_choice !== undefined) {
    const choice = object(request.tool_choice, 'tool_choice');
    if (choice.type !== 'auto' || choice.disable_parallel_tool_use === true) {
      throw new RequestError('Unsupported tool_choice; this adapter currently supports unrestricted auto');
    }
  }
  const options: ParsedMessages['options'] = { maxTokens: Number(request.max_tokens) };
  if (request.output_config !== undefined) {
    const output = object(request.output_config, 'output_config');
    if (Object.keys(output).some((key) => key !== 'effort')) throw new RequestError('Unsupported output_config; structured output is not implemented');
    if (output.effort !== undefined) {
      if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(String(output.effort))) throw new RequestError('Unsupported effort');
      options.reasoningEffort = String(output.effort);
    }
  }
  for (const [field, target] of [['temperature', 'temperature'], ['top_p', 'topP']] as const) {
    if (request[field] === undefined) continue;
    const amount = request[field];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1) {
      throw new RequestError(`${field} must be a number from 0 to 1`);
    }
    options[target] = amount;
  }
  if (request.stop_sequences !== undefined) {
    options.stop = list(request.stop_sequences, 'stop_sequences', 16)
      .map((item) => string(item, 'stop sequence'));
  }
  const toolNames = new Set<string>();
  const advertised = list(request.tools ?? [], 'tools', 256);
  const tools = mode === 'session' ? [] : advertised.map((item) => {
    const tool = object(item, 'Tool');
    if (tool.type !== undefined && tool.type !== 'custom') throw new RequestError('Unsupported server-side tool');
    if (tool.defer_loading === true) throw new RequestError('Unsupported deferred tool loading');
    const toolName = name(tool.name);
    if (toolNames.has(toolName)) throw new RequestError('Duplicate tool name');
    toolNames.add(toolName);
    return { name: toolName, description: tool.description === undefined ? '' : string(tool.description, 'Tool description'),
      input: object(tool.input_schema, 'Tool input schema') };
  });
  const calls = new Map<string, string>();
  const results = new Set<string>();
  const messages: ModelMessage[] = [];
  for (const item of list(request.messages, 'messages', 2000)) {
    const message = object(item, 'Message');
    // Custom-model clients may put frontend instructions in message roles.
    // OpenCode owns the agent instructions in session mode.
    if (mode === 'session' && (message.role === 'system' || message.role === 'developer')) continue;
    if (message.role !== 'user' && message.role !== 'assistant') {
      const known = ['system', 'developer', 'tool', 'function'].includes(String(message.role)) ? ': ' + String(message.role) : '';
      throw new RequestError('Unsupported message role' + known);
    }
    const role = message.role;
    const blocks = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }] : list(message.content, 'Message content', 4096);
    let current: ModelMessage | undefined;
    for (const item of blocks) {
      const block = object(item, 'Content block');
      let part: ModelPart;
      let partRole: ModelMessage['role'] = role;
      if (block.type === 'text') {
        part = { type: 'text', text: string(block.text, 'Content text') };
      } else if (block.type === 'tool_use' && role === 'assistant') {
        const id = string(block.id, 'Tool call ID');
        if (!id || id.length > 256 || calls.has(id)) throw new RequestError('Invalid or duplicate tool call ID');
        const toolName = name(block.name);
        calls.set(id, toolName);
        part = { type: 'tool-call', id, name: toolName, input: object(block.input, 'Tool arguments') };
      } else if (block.type === 'tool_result' && role === 'user') {
        const id = string(block.tool_use_id, 'Tool result ID');
        const toolName = calls.get(id);
        if (!toolName || results.has(id)) throw new RequestError('Unknown or duplicate tool result ID');
        results.add(id);
        if (block.is_error !== undefined && typeof block.is_error !== 'boolean') throw new RequestError('is_error must be boolean');
        partRole = 'tool';
        part = { type: 'tool-result', id, name: toolName, result: {
          type: block.is_error ? 'error' : 'text',
          value: texts(block.content ?? '', 'tool_result').map((text) => text.text).join('\n'),
        } };
      } else {
        throw new RequestError('Unsupported content block or role');
      }
      if (!current || current.role !== partRole) {
        current = { role: partRole, content: [] };
        messages.push(current);
      }
      current.content.push(part);
    }
  }
  if (!messages.length) throw new RequestError('At least one message is required');
  const userId = request.metadata === undefined ? undefined : object(request.metadata, 'metadata').user_id;
  if (userId !== undefined && (typeof userId !== 'string' || userId.length > 1024)) throw new RequestError('Invalid metadata.user_id');
  return { model, stream: request.stream === true, tools, messages, options,
    ...(typeof userId === 'string' ? { userId } : {}),
    system: request.system === undefined ? [] : texts(request.system, 'system') };
}
