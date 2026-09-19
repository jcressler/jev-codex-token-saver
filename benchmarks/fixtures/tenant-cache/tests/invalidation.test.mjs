import assert from 'node:assert/strict';
import test from 'node:test';
import { invalidationTopic } from '../src/invalidation.mjs';

test('invalidation topics include tenant and product', () => {
  assert.equal(invalidationTopic('north', 'rose-1'), 'catalog:north:rose-1:invalidate');
});
