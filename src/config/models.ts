import { createHash } from 'node:crypto';
import type { ModelTarget } from '../opencode/adapter.js';

export interface CatalogModel {
  key: string; target: ModelTarget; alias: string; name: string;
  free: boolean; supported: boolean; context: number; output: number;
}
export function modelAlias(key: string): string {
  return `claude-sonnet-4-6-oc-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}
export function catalog(value: unknown, mode: 'session' | 'model' = 'session'): CatalogModel[] {
  const data = (value as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('Unrecognized OpenCode model catalog');
  return data.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const model = item as Record<string, unknown>;
    if (typeof model.providerID !== 'string' || typeof model.id !== 'string' || !model.providerID || !model.id) return [];
    const capabilities = model.capabilities as { tools?: boolean; input?: string[] } | undefined;
    const costs = model.cost as { input?: number; output?: number }[] | undefined;
    const limit = model.limit as { context?: number; output?: number } | undefined;
    const key = `${model.providerID}/${model.id}`;
    // Legacy model-only tests need a response-hook wire filter. Genuine agent
    // sessions let OpenCode handle its own provider protocols.
    const compatible = ['@opencode/ai/providers/openai-compatible', '@opencode/ai/providers/openrouter', '@opencode/ai/providers/deepseek'].includes(String(model.package));
    return [{ key, target: { providerID: model.providerID, id: model.id }, alias: modelAlias(key),
      name: typeof model.name === 'string' ? model.name : key,
      free: Array.isArray(costs) && costs.length > 0 && costs.every(cost => cost.input === 0 && cost.output === 0),
      supported: (mode === 'session' || compatible) && model.enabled === true && model.status !== 'deprecated' && capabilities?.tools === true,
      context: typeof limit?.context === 'number' ? limit.context : 200000,
      output: typeof limit?.output === 'number' ? limit.output : 8192 }];
  }).sort((a, b) => a.key.localeCompare(b.key));
}
export function selectModel(models: CatalogModel[], key: string | undefined): CatalogModel {
  if (!key) throw new Error('Select a model: opencode-claude model set <provider/model>');
  const selected = models.find(model => model.key === key);
  if (!selected) throw new Error('Model is absent from the current OpenCode catalog. Run opencode-claude models.');
  if (!selected.supported) throw new Error('Model is unsupported: disabled, deprecated, or lacks agent tools');
  return selected;
}
