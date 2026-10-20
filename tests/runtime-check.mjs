import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createFixture } from '../experiments/native-tools/fixture-model.mjs';
import { launchRuntime } from '../dist/opencode/runtime.js';

const fixture = await createFixture();
let runtime;
try {
  runtime = await launchRuntime({
    stateRoot: fileURLToPath(new URL('../.runtime/', import.meta.url)), isolated: true,
    config: {
      providers: { fixture: {
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: fixture.url + '/v1', apiKey: fixture.token },
        models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } },
      } },
    },
  });
  assert.equal(runtime.version, '2.0.32');
  const created = await runtime.api('POST', '/api/session', {
    model: { providerID: 'fixture', id: 'probe' }, location: { directory: runtime.workspace },
    permissions: [{ action: '*', resource: '*', effect: 'deny' }],
  });
  const response = await runtime.api('POST', `/api/session/${created.data.id}/generate`, {
    prompt: 'Reply with a fixture title. Do not use tools.',
  });
  assert.equal(response.data.text, 'Fixture title');
  console.log('Owned runtime startup, generation, and cleanup check PASS');
} finally {
  await runtime?.stop();
  await fixture.close();
}
