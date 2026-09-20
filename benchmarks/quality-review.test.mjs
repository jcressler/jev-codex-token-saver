import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gradeAnswer } from './evaluation-v2.mjs';
import { anonymizeAnswers, reproduceKnownDefect } from './quality-review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(here, 'evaluation-v2.manifest.json'), 'utf8'));

test('grader accepts the previously false-negative Jev paraphrase', () => {
  const task = manifest.tasks.find(item => item.id === 'webhook-raw-body-signature');
  const answer = {
    cause: '`receiveWebhook` converts `rawBody` into an object before authentication. `expectedSignature` hashes `JSON.stringify(body)`, not the provider-signed Buffer. Reserialization strips whitespace and may change property enumeration order, producing different bytes and a different HMAC.',
    codeLocations: ['src/route.mjs:4-6', 'src/body-parser.mjs:1-2', 'src/signature.mjs:3-4'],
    minimalFix: 'Verify before parsing: pass the original rawBody Buffer to signatureMatches and hash it directly.',
    testGap: 'Test semantically identical payload Buffers with different whitespace and reordered properties; sign and verify each exact byte representation.',
  };
  assert.equal(gradeAnswer(task, answer).passed, true);
});

test('grader rejects plausible but causally wrong answers', () => {
  const cache = manifest.tasks.find(item => item.id === 'tenant-cache-isolation');
  const wrongCache = {
    cause: 'The per-tenant cache key is correct, but the invalidation event arrives late and returns stale data.',
    codeLocations: ['src/invalidation.mjs:1-4'],
    minimalFix: 'Retry invalidation sooner.',
    testGap: 'Test event timing.',
  };
  const webhook = manifest.tasks.find(item => item.id === 'webhook-raw-body-signature');
  const wrongWebhook = {
    cause: 'The body parser preserves the signed bytes; the provider is using the wrong secret.',
    codeLocations: ['config/provider.json:1-3'],
    minimalFix: 'Rotate the secret after parsing.',
    testGap: 'Test another secret.',
  };
  assert.equal(gradeAnswer(cache, wrongCache).passed, false);
  assert.equal(gradeAnswer(webhook, wrongWebhook).passed, false);
});

test('near-threshold automatic failures require blinded review', () => {
  const task = manifest.tasks.find(item => item.id === 'webhook-raw-body-signature');
  const answer = {
    cause: 'The raw request body is parsed before verification. JSON.stringify then changes whitespace before HMAC verification.',
    codeLocations: ['src/route.mjs:4-6'],
    minimalFix: 'Verify the original raw Buffer before parsing.',
    testGap: 'Add a broad integration test.',
  };
  const quality = gradeAnswer(task, answer);
  assert.equal(quality.passed, false);
  assert.equal(quality.reviewRequired, true);
});

test('blinded review packet excludes arm and run labels', () => {
  const blinded = anonymizeAnswers([
    { runId: 'r1', taskId: 'task-a', arm: 'jev', repetition: 1, answer: { cause: 'answer one' }, usage: { input_tokens: 10 } },
    { runId: 'r2', taskId: 'task-a', arm: 'stock', repetition: 1, answer: { cause: 'answer two' }, usage: { input_tokens: 20 } },
  ], 'fixed-seed');
  const publicText = JSON.stringify(blinded.review);
  assert.equal(publicText.includes('jev'), false);
  assert.equal(publicText.includes('stock'), false);
  assert.equal(publicText.includes('r1'), false);
  assert.equal(publicText.includes('input_tokens'), false);
  assert.equal(blinded.mapping.labels.length, 2);
});

test('executable oracles reproduce both frozen fixture defects', async () => {
  const tenant = await reproduceKnownDefect('tenant-cache-isolation', resolve(here, 'fixtures/tenant-cache'));
  const webhook = await reproduceKnownDefect('webhook-raw-body-signature', resolve(here, 'fixtures/webhook-signature'));
  assert.equal(tenant.reproduced, true, JSON.stringify(tenant));
  assert.equal(webhook.reproduced, true, JSON.stringify(webhook));
});
