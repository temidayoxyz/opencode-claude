import assert from 'node:assert/strict';
import test from 'node:test';
import { providerFailure } from '../dist/gateway/server.js';

test('provider-errors: restrictions, quotas and authentication are distinct and redact bodies', () => {
  assert.match(providerFailure(new Error('403 FreeTierError PRIVATE_PROMPT')), /denied access/);
  assert.match(providerFailure(new Error('429 PRIVATE_TOKEN')), /rate limit/);
  assert.match(providerFailure(new Error('401 PRIVATE_KEY')), /authentication/);
  assert.equal(providerFailure(new Error('sensitive original request')), 'OpenCode generation failed or returned an unsupported response. Check the selected model in OpenCode.');
});
