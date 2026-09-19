import assert from 'node:assert/strict';
import test from 'node:test';
import { resetPrices } from '../src/cache.mjs';
import { catalogPrice } from '../src/catalog.mjs';

test('a repeated product lookup uses the cached price', async () => {
  resetPrices();
  let calls = 0;
  const load = async () => { calls += 1; return 14.99; };
  assert.equal(await catalogPrice('north', 'rose-1', load), 14.99);
  assert.equal(await catalogPrice('north', 'rose-1', load), 14.99);
  assert.equal(calls, 1);
});
