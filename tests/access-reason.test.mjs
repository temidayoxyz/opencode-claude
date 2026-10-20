import assert from 'node:assert/strict';
import test from 'node:test';
import { accessReason, responseAccessReason } from '../src/opencode/access.ts';

test('provider-errors: distinguish client, network and regional refusals without returning bodies', async () => {
  assert.equal(accessReason({ error: { message: "OpenCode's free tier can only be used from within OpenCode. PRIVATE" } }), 'client_only');
  assert.equal(accessReason({ error: { message: 'Free models unavailable on current network due to abusive traffic from this IP' } }), 'network');
  assert.equal(accessReason({ error: { type: 'RegionError', message: 'PRIVATE' } }), 'region');
  assert.equal(accessReason({ error: { message: 'PRIVATE unrecognized denial' } }), 'unknown');
  assert.equal(await responseAccessReason(new Response('{"error":{"type":"RegionError"}}')), 'region');
  assert.equal(await responseAccessReason(new Response('x'.repeat(20000))), 'unknown');
});
