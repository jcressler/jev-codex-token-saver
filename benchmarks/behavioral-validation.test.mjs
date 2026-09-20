import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateBehavioralAnswer } from './behavioral-validation.mjs';

const here = dirname(fileURLToPath(import.meta.url));

async function privateFixture(name) {
  const scratch = await mkdtemp(join(tmpdir(), 'jev-validation-test-'));
  const fixtureRoot = join(scratch, 'workspace');
  await cp(resolve(here, 'fixtures', name), fixtureRoot, { recursive: true });
  return { scratch, fixtureRoot };
}

const tenantSource = `const prices = new Map();

function cacheKey(tenantId, productId) {
  return JSON.stringify([tenantId, productId]);
}

export function readPrice(tenantId, productId) {
  return prices.get(cacheKey(tenantId, productId));
}

export function writePrice(tenantId, productId, price) {
  prices.set(cacheKey(tenantId, productId), price);
}

export function resetPrices() {
  prices.clear();
}
`;

const tenantRegression = `import assert from 'node:assert/strict';
import test from 'node:test';
import { resetPrices } from '../src/cache.mjs';
import { catalogPrice } from '../src/catalog.mjs';

test('catalog prices stay isolated by tenant', async () => {
  resetPrices();
  assert.equal(await catalogPrice('north', 'rose-1', async () => 14.99), 14.99);
  assert.equal(await catalogPrice('south', 'rose-1', async () => 19.99), 19.99);
});
`;

const webhookRoute = `import { parseJsonBody } from './body-parser.mjs';
import { signatureMatches } from './signature.mjs';

export function receiveWebhook(rawBody, signature, secret) {
  if (!signatureMatches(secret, rawBody, signature)) throw new Error('invalid signature');
  return parseJsonBody(rawBody);
}
`;

const webhookSignature = `import { createHmac, timingSafeEqual } from 'node:crypto';

export function expectedSignature(secret, rawBody) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function signatureMatches(secret, rawBody, supplied) {
  const expected = Buffer.from(expectedSignature(secret, rawBody), 'hex');
  const actual = Buffer.from(supplied, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
`;

const webhookRegression = `import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { receiveWebhook } from '../src/route.mjs';

test('webhook verifies the exact raw request bytes', () => {
  const secret = 'test-secret';
  const raw = Buffer.from('{ "status": "paid", "id": 7 }');
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.deepEqual(receiveWebhook(raw, signature, secret), { status: 'paid', id: 7 });
});
`;

function answer(task, replacements, regression) {
  return {
    cause: `The ${task} fixture has a behavior bug.`,
    codeLocations: ['src/cache.mjs'],
    replacements,
    regressionTest: { path: 'tests/submitted-regression.test.mjs', content: regression },
  };
}

test('accepts a copied tenant fixture under an arbitrary workspace basename', async () => {
  const { scratch, fixtureRoot } = await privateFixture('tenant-cache');
  try {
    const result = await validateBehavioralAnswer({
      taskId: 'tenant-cache-isolation',
      fixtureRoot,
      answer: answer('tenant cache', [{ path: 'src/cache.mjs', content: tenantSource }], tenantRegression),
    });
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(result.checks.regressionFailsOnOriginal, true);
    assert.equal(result.checks.hiddenBehavior, true);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('accepts raw-byte webhook verification and rejects tampered signatures', async () => {
  const { scratch, fixtureRoot } = await privateFixture('webhook-signature');
  try {
    const result = await validateBehavioralAnswer({
      taskId: 'webhook-raw-body-signature',
      fixtureRoot,
      answer: answer('webhook', [
        { path: 'src/route.mjs', content: webhookRoute },
        { path: 'src/signature.mjs', content: webhookSignature },
      ], webhookRegression),
    });
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(result.checks.regressionFailsOnOriginal, true);
    assert.equal(result.checks.hiddenBehavior, true);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('rejects a tenant no-op and an incorrect tenant-only cache key', async () => {
  for (const content of [
    `const prices = new Map();\nexport function readPrice(_tenant, product) { return prices.get(product); }\nexport function writePrice(_tenant, product, price) { prices.set(product, price); }\nexport function resetPrices() { prices.clear(); }\n`,
    `const prices = new Map();\nexport function readPrice(tenant) { return prices.get(tenant); }\nexport function writePrice(tenant, _product, price) { prices.set(tenant, price); }\nexport function resetPrices() { prices.clear(); }\n`,
  ]) {
    const { scratch, fixtureRoot } = await privateFixture('tenant-cache');
    try {
      const result = await validateBehavioralAnswer({
        taskId: 'tenant-cache-isolation',
        fixtureRoot,
        answer: answer('tenant cache', [{ path: 'src/cache.mjs', content }], tenantRegression),
      });
      assert.equal(result.passed, false, JSON.stringify(result));
      assert.equal(result.checks.regressionFailsOnOriginal, true);
      assert.equal(result.checks.hiddenBehavior, false);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
});

test('rejects a webhook patch that still hashes parsed or reserialized JSON', async () => {
  const { scratch, fixtureRoot } = await privateFixture('webhook-signature');
  try {
    const result = await validateBehavioralAnswer({
      taskId: 'webhook-raw-body-signature',
      fixtureRoot,
      answer: answer('webhook', [
        { path: 'src/route.mjs', content: webhookRoute },
      ], webhookRegression),
    });
    assert.equal(result.passed, false, JSON.stringify(result));
    assert.equal(result.checks.regressionFailsOnOriginal, true);
    assert.equal(result.checks.hiddenBehavior, false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('rejects paths outside existing source files without running supplied code', async () => {
  const result = await validateBehavioralAnswer({
    taskId: 'tenant-cache-isolation',
    fixtureRoot: resolve(here, 'fixtures', 'tenant-cache'),
    answer: answer('tenant cache', [{ path: '../package.json', content: '{}' }], tenantRegression),
  });
  assert.equal(result.passed, false);
  assert.equal(result.checks.allowedPaths, false);
  assert.equal(result.outputs.originalTests, undefined);
});
