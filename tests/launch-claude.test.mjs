import assert from 'node:assert/strict';
import test from 'node:test';
import { launchEnvironment } from '../dist/claude-code/launch.js';

test('launch-claude: routing is scoped, secondary models use the selection, original env survives', () => {
  const original = { PATH: '/bin', CUSTOM: 'keep', ANTHROPIC_API_KEY: 'original', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_OAUTH_TOKEN: 'old' };
  const env = launchEnvironment({ url: 'http://127.0.0.1:1', token: 'local' }, { alias: 'alias', output: 10000, context: 128000 }, original);
  assert.equal(env.ANTHROPIC_API_KEY, '');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'local');
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'alias');
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, '');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, '');
  assert.equal(env.CUSTOM, 'keep');
  assert.equal(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '128000');
  assert.equal(original.ANTHROPIC_API_KEY, 'original');
});
