import assert from 'node:assert/strict';
import test from 'node:test';
import { catalog, modelAlias, selectModel } from '../dist/config/models.js';

test('model-selection: stable aliases retain slash-containing IDs without exposing settings', () => {
  const models = catalog({ data: [{ providerID: 'router', id: 'vendor/model:free', name: 'Model', enabled: true, status: 'active',
    package: '@opencode/ai/providers/openai-compatible', capabilities: { tools: true }, cost: [{ input: 0, output: 0 }], settings: { apiKey: 'PRIVATE' } }] });
  assert.equal(models[0].key, 'router/vendor/model:free');
  assert.equal(models[0].free, true);
  assert.equal(models[0].alias, modelAlias('router/vendor/model:free'));
  assert.equal(JSON.stringify(models).includes('PRIVATE'), false);
  assert.equal(selectModel(models, models[0].key), models[0]);
  assert.throws(() => selectModel(models, 'missing/model'), /absent/);
  assert.throws(() => selectModel([{ ...models[0], supported: false }], models[0].key), /unsupported/);
});
