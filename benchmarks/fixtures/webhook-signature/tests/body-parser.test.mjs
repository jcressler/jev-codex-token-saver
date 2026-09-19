import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonBody } from '../src/body-parser.mjs';

test('parses whitespace around JSON properties', () => {
  assert.deepEqual(parseJsonBody(Buffer.from('{ "id": 7 }')), { id: 7 });
});
