import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertCampaignStartable, assertSmokeStartable, atomicJson, budgetExceeded,
  codexArgs, gradeAnswer, makePlan, parseCodexEvents, runProcess, validateManifest,
} from './evaluation-v2.mjs';

const manifest = JSON.parse(await readFile(new URL('./evaluation-v2.manifest.json', import.meta.url), 'utf8'));

test('frozen manifest validates and produces exactly twelve balanced executions', async () => {
  const validation = await validateManifest(manifest);
  assert.equal(validation.expectedRuns, 12);
  assert.deepEqual(makePlan(manifest), validation.plan);
  for (const arm of manifest.campaign.arms) {
    const positions = [1, 2, 3].map(position => validation.plan.filter(run => run.arm === arm && run.position === position).length);
    assert.ok(Math.max(...positions) - Math.min(...positions) <= 1);
  }
});

test('frozen graders accept known correct answers and reject vague answers', () => {
  const cache = manifest.tasks.find(task => task.id === 'tenant-cache-isolation');
  const cacheAnswer = {
    cause: 'The map key uses only productId and ignores the tenant, so a later tenant cache hit returns the first tenant cached price.',
    codeLocations: ['src/cache.mjs:1-9', 'src/catalog.mjs:3-8'],
    minimalFix: 'Use a composite tenant and product key in the map.',
    testGap: 'Test two distinct tenants requesting the same product and expect separate prices.',
  };
  assert.deepEqual(gradeAnswer(cache, cacheAnswer).passed, true);
  const webhook = manifest.tasks.find(task => task.id === 'webhook-raw-body-signature');
  const webhookAnswer = {
    cause: 'JSON.parse loses the original raw body bytes, then JSON.stringify reserializes it for the HMAC signature; whitespace or property order changes the bytes.',
    codeLocations: ['src/signature.mjs:3-10', 'src/body-parser.mjs:1-3'],
    minimalFix: 'Verify the signature against the original raw Buffer before parsing the body.',
    testGap: 'Add a test using raw JSON with whitespace and expect exact byte verification to pass.',
  };
  assert.deepEqual(gradeAnswer(webhook, webhookAnswer).passed, true);
  assert.deepEqual(gradeAnswer(cache, { cause: 'Caching is broken.', codeLocations: [], minimalFix: 'Fix it.', testGap: 'Test it.' }).passed, false);
});

test('event parsing preserves success, tool failure, malformed lines, and missing usage', () => {
  const stdout = [
    'not json',
    JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', exit_code: 1 } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"cause":"x"}' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 50, output_tokens: 4 } }),
  ].join('\n');
  assert.deepEqual(parseCodexEvents(stdout), {
    usage: { input_tokens: 50, output_tokens: 4 }, finalText: '{"cause":"x"}', toolCalls: 1, failedToolCalls: 1,
  });
  assert.equal(parseCodexEvents('{bad json').usage, undefined);
});

test('local process harness records success and enforces timeout without a model call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-runner-test-'));
  try {
    const success = await runProcess(process.execPath, ['-e', 'console.log("ok")'], {
      cwd: root, env: process.env, timeoutMs: 2_000,
      stdoutPath: join(root, 'success.out'), stderrPath: join(root, 'success.err'),
    });
    assert.equal(success.code, 0);
    assert.equal(success.stdout.trim(), 'ok');
    const timeout = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      cwd: root, env: process.env, timeoutMs: 30,
      stdoutPath: join(root, 'timeout.out'), stderrPath: join(root, 'timeout.err'),
    });
    assert.equal(timeout.timedOut, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('durable state writes survive replacement and running or failed work cannot retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-state-test-'));
  const path = join(root, 'state.json');
  try {
    await atomicJson(path, { completed: [{ runId: '01' }] });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { completed: [{ runId: '01' }] });
    assert.throws(() => assertSmokeStartable({ smoke: { status: 'running', launches: 1 } }), /automatic retry/);
    assert.throws(() => assertCampaignStartable({ smoke: { status: 'completed', result: { passed: true } }, campaign: { status: 'failed', launches: 2 } }), /automatic resume or retry/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('budget and command configuration gates are explicit', () => {
  const atLimit = {
    codexInputTokens: manifest.campaign.budgets.maxCodexInputTokens,
    codexOutputTokens: 0, codexToolCalls: 0, jevInputTokens: 0, jevRequests: 0,
  };
  assert.equal(budgetExceeded(manifest, atLimit), false);
  assert.equal(budgetExceeded(manifest, { ...atLimit, codexInputTokens: atLimit.codexInputTokens + 1 }), true);
  const args = codexArgs(manifest, 'fixture', 'schema.json', 'prompt');
  assert.ok(args.includes('gpt-5.6-sol'));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('approval_policy="never"'));
  assert.equal(args.includes('-a'), false);
});
