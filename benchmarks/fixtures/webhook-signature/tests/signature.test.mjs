import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { receiveWebhook } from '../src/route.mjs';

test('accepts the compact JSON example', () => {
  const secret = 'test-secret';
  const raw = Buffer.from('{"id":7,"status":"paid"}');
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.deepEqual(receiveWebhook(raw, signature, secret), { id: 7, status: 'paid' });
});
