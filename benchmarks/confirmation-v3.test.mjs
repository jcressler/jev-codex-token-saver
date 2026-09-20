import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readLargeTextEvidence, searchWorkspaceEvidence } from '../src/evidence-service.mjs';
import { ARMS, REPETITIONS, TASKS, createFixtures, gradeAnswer, makePlan, promptLeaksOracle } from './confirmation-v3-tasks.mjs';
import { BLOCK_RUNS, TOTAL_RUNS, codexArgs, createExecutionRoot, evidenceSupportsFrozenFacts, executionInvalidReasons, jevCredentialSmoke, makeMonitor, mockJev, pairedBootstrap, parseEvents, promptFor, reservePreflightAttempt, taskInput, toolPolicy } from './confirmation-v3.mjs';

const REFERENCE_ANSWERS = {
  'pricing-feed-token-incident': {
    finding: 'PRC-8044 fails because FeedTokenConfigurationError reports PRICING_FEED_TOKEN as invalid.',
    codeLocations: ['loadPricingFeedPolicy at src/pricing-policy.ts:83:11', 'startPricingFeed at src/pricing-worker.ts:152:7'],
    minimalFix: 'Set PRICING_FEED_TOKEN to the valid deployed token.', testGap: 'Add a regression test for missing and valid feed token values.', confidence: 1,
  },
  'inventory-pool-incident': {
    finding: 'INV-3307 fails because PoolConfigurationError identifies INVENTORY_DB_POOL_SIZE as invalid.',
    codeLocations: ['createInventoryPool at src/db.ts:119:13', 'startInventorySync at src/sync.ts:207:5'],
    minimalFix: 'Configure INVENTORY_DB_POOL_SIZE with a valid positive value.', testGap: 'Add a regression test for zero and positive pool sizes.', confidence: 1,
  },
  'catalog-batch-incident': {
    finding: 'CAT-6721 fails because BatchSizeConfigurationError identifies CATALOG_INDEX_BATCH_SIZE as invalid.',
    codeLocations: ['loadIndexBatchPolicy at src/index-policy.ts:58:9', 'startCatalogIndexer at src/catalog-indexer.ts:131:5'],
    minimalFix: 'Set CATALOG_INDEX_BATCH_SIZE to a valid positive batch size.', testGap: 'Add a regression test for invalid and valid batch sizes.', confidence: 1,
  },
  'webhook-byte-verification': {
    finding: 'JSON.parse discards byte identity and JSON.stringify reserializes the parsed body before HMAC signature verification, so it differs from the exact raw bytes the provider signed.',
    codeLocations: ['src/http/body-parser.mjs:1-3', 'src/webhooks/verify.mjs:3-6'],
    minimalFix: 'Verify the HMAC against the original raw body bytes before parsing JSON.', testGap: 'Cover whitespace and property order changes that preserve JSON meaning but alter bytes.', confidence: 1,
  },
  'session-cache-region-scope': {
    finding: 'The cache keys sessions solely with sessionId and omits regionId, so loadSession in another region reuses and returns the prior cached session.',
    codeLocations: ['src/sessions/cache.mjs:1-9', 'src/sessions/load.mjs:3-8'],
    minimalFix: 'Use regionId plus sessionId as the cache identity.', testGap: 'Test two different regions with the same session ID.', confidence: 1,
  },
  'permission-cache-org-scope': {
    finding: 'The permission store indexes entries only by userId and drops orgId, so authorize can reuse cached permissions in another organization.',
    codeLocations: ['src/auth/permission-cache.mjs:1-9', 'src/auth/authorize.mjs:3-7'],
    minimalFix: 'Key permissions by organization and user together.', testGap: 'Test one user switching between two organizations.', confidence: 1,
  },
  'currency-rounding-regression': {
    finding: 'Binary floating-point multiplication in Math.round(amount * 100) represents 1.005 low enough to produce 100 instead of 101.',
    codeLocations: ['src/money/cents.mjs:1-3', 'tests/money.test.mjs:1'],
    minimalFix: 'Use decimal-safe string parsing or a fixed-point currency library.', testGap: 'Assert 1.005 converts to 101 cents.', confidence: 1,
  },
  'retry-max-attempts-regression': {
    finding: 'The inclusive attempt <= maxAttempts loop executes four calls when maxAttempts is three.',
    codeLocations: ['src/network/retry.mjs:1-10', 'tests/retry.test.mjs:1'],
    minimalFix: 'Use the exclusive bound attempt < maxAttempts.', testGap: 'Assert exactly three calls for maxAttempts=3.', confidence: 1,
  },
  'abort-retry-regression': {
    finding: 'The catch treats AbortError like a retryable failure and continues to another fetch.',
    codeLocations: ['src/network/fetch-retry.mjs:1-10', 'tests/fetch-retry.test.mjs:1'],
    minimalFix: 'Rethrow AbortError immediately and do not retry.', testGap: 'Assert cancellation makes one call with no additional fetch.', confidence: 1,
  },
  'queue-visibility-contract': {
    finding: 'The 30-second visibility timeout expires during the 90-second handler, making the job visible again and causing duplicate redelivery.',
    codeLocations: ['config/export-queue.json:1-5', 'docs/export-worker.md:1'],
    minimalFix: 'Set visibility longer than the maximum runtime plus margin.', testGap: 'Test that no redelivery occurs after the old visibility expiration.', confidence: 1,
  },
  'environment-precedence-contract': {
    finding: 'loadConfig copies the environment value 600 first, then overwrites it with the packaged default 60, reversing the required precedence.',
    codeLocations: ['src/config/load.mjs:3-7', 'config/defaults.json:1'],
    minimalFix: 'Apply defaults first and environment last so the environment overrides.', testGap: 'Add an environment-over-default precedence test that expects 600.', confidence: 1,
  },
  'rollout-unit-contract': {
    finding: 'checkoutPercent is 25 on a whole percentage 0 to 100 scale, but dividing by 100 makes the threshold 0.25 while seededPercent also returns 0 to 99.',
    codeLocations: ['src/features/rollout.mjs:1-7', 'docs/feature-flags.md:1'],
    minimalFix: 'Remove the / 100 conversion so both values use the same units.', testGap: 'Add a representative 25-percent distribution test.', confidence: 1,
  },
};

test('confirmation plan has twelve holdouts, three categories each, and 108 balanced runs', () => {
  assert.equal(TASKS.length, 12);
  assert.equal(REPETITIONS, 3);
  assert.equal(BLOCK_RUNS, 36);
  assert.equal(TOTAL_RUNS, 108);
  const categories = TASKS.reduce((counts, task) => ({ ...counts, [task.category]: (counts[task.category] ?? 0) + 1 }), {});
  assert.deepEqual(categories, { 'noisy-log': 3, 'large-repository': 3, 'failing-test': 3, 'mixed-doc-config': 3 });
  const plan = makePlan();
  assert.equal(plan.length, 108);
  assert.equal(new Set(plan.map(row => row.runId)).size, 108);
  for (const task of TASKS) for (const arm of ARMS) {
    const rows = plan.filter(row => row.taskId === task.id && row.arm === arm);
    assert.equal(rows.length, 3);
    assert.deepEqual(new Set(rows.map(row => row.position)).size, 3);
  }
});

test('task prompts contain categories of facts without oracle values', () => {
  for (const task of TASKS) {
    assert.deepEqual(promptLeaksOracle(task), [], task.id);
    const stock = promptFor(task, 'stock', 'fixture');
    const assisted = promptFor(task, 'jev', 'fixture');
    assert.match(stock, /normal efficient Codex search/i);
    assert.match(assisted, /exactly once/i);
    assert.ok(!assisted.includes('TYPESAFE_API_KEY'));
  }
});

test('all candidate packets are Jev-eligible and a semantic mock recovers frozen causal evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-confirmation-v3-'));
  try {
    await createFixtures(root);
    for (const task of TASKS) {
      const input = taskInput(task, join(root, task.id));
      const fn = task.tool === 'read_large_text_evidence' ? readLargeTextEvidence : searchWorkspaceEvidence;
      const local = await fn(input, { apiKey: undefined });
      const mockedJev = await fn(input, { ask: mockJev });
      assert.equal(local.mode, 'local-fallback', task.id);
      assert.equal(local.metrics.jevRequests, 0, task.id);
      assert.ok(local.metrics.estimatedCandidateTokens > 2_000, task.id);
      assert.equal(mockedJev.mode, 'jev', task.id);
      assert.equal(mockedJev.metrics.jevRequests, 1, task.id);
      assert.equal(evidenceSupportsFrozenFacts(task, mockedJev.evidence).passed, true, task.id);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('frozen graders accept realistic paraphrases and reject an empty or vague answer', () => {
  for (const task of TASKS) {
    const reference = REFERENCE_ANSWERS[task.id];
    assert.ok(reference, `${task.id} has a reference answer`);
    assert.equal(gradeAnswer(task, reference).passed, true, `${task.id} reference`);
    assert.equal(gradeAnswer(task, { finding: 'There is a bug.', codeLocations: ['src/file.mjs'], minimalFix: 'Fix it.', testGap: 'Test it.' }).passed, false, task.id);
    assert.equal(gradeAnswer(task, { ...reference, finding: 'A nearby component emitted a warning, but the causal path is unknown.' }).passed, false, `${task.id} wrong cause`);
    assert.equal(gradeAnswer(task, { ...reference, minimalFix: 'Restart the service without changing code or configuration.' }).passed, false, `${task.id} wrong fix`);
  }
});

test('answer correctness is measured separately from execution validity', () => {
  const parsed = { usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 }, malformedLines: [] };
  const processResult = { code: 0, timedOut: false, monitorViolation: undefined, routerErrorCount: 0 };
  const invalidReasons = executionInvalidReasons({ processResult, parsed, answer: { finding: 'wrong but structured' }, policy: { passed: true }, fixtureUnchanged: true });
  assert.deepEqual(invalidReasons, []);
  assert.equal(gradeAnswer(TASKS[0], { finding: 'wrong but structured' }).passed, false);
});

test('stock runaway monitor permits 30 calls and stops call 31', () => {
  const monitor = makeMonitor('stock');
  const event = { type: 'item.started', item: { type: 'command_execution' } };
  for (let index = 0; index < 30; index += 1) assert.equal(monitor(event), undefined, `call ${index + 1}`);
  assert.match(monitor(event), /stock tool-call cap exceeded/);
});

test('Codex configuration isolates assisted tools and preserves supported approval settings', () => {
  const task = TASKS[0];
  const assisted = codexArgs(task, 'jev', 'fixture', 'schema', 'diagnostics', 'prompt');
  const stock = codexArgs(task, 'stock', 'fixture', 'schema', 'diagnostics', 'prompt');
  assert.ok(assisted.includes('approval_policy="never"'));
  assert.ok(assisted.includes('model_reasoning_effort="high"'));
  assert.ok(assisted.includes('features.shell_tool=false'));
  assert.ok(stock.includes('features.shell_tool=true'));
  assert.equal(assisted.includes('-a'), false);
});

test('event and tool policy accounting fail closed while allowing recorded stock misses', () => {
  const parsed = parseEvents([
    JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', exit_code: 1, status: 'failed' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{}' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 } }),
  ].join('\n'));
  const policy = toolPolicy('stock', parsed, []);
  assert.equal(policy.failedCount, 1);
  assert.equal(policy.failedAllowed, true);
  assert.equal(policy.passed, true);

  const gateway = parseEvents([
    JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'jev_token_saver', tool: 'search_workspace_evidence' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'jev_token_saver', tool: 'search_workspace_evidence', status: 'completed' } }),
    JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'jev_token_saver', tool: 'read_selected_evidence' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'jev_token_saver', tool: 'read_selected_evidence', status: 'completed' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 } }),
  ].join('\n'));
  const diagnostic = [{ record: { mode: 'jev', metrics: { jevRequests: 1, jevUsage: { input_tokens: 50, output_tokens: 4 } }, diagnostics: { model: 'jev-1.13.0' } } }];
  assert.equal(toolPolicy('jev', gateway, diagnostic).passed, true);
  assert.equal(toolPolicy('jev', gateway, [{ record: { ...diagnostic[0].record, diagnostics: { model: 'wrong' } } }]).passed, false);
});

test('paired bootstrap reports positive and negative task-level effects correctly', () => {
  const win = pairedBootstrap([{ stock: 100, jev: 70 }, { stock: 200, jev: 120 }, { stock: 80, jev: 60 }], 2_000);
  assert.ok(win.estimatePercent > 20);
  assert.ok(win.lower95Percent > 0);
  const loss = pairedBootstrap([{ stock: 100, jev: 120 }, { stock: 200, jev: 230 }, { stock: 80, jev: 90 }], 2_000);
  assert.ok(loss.estimatePercent < 0);
  assert.ok(loss.upper95Percent < 0);
});

test('preparation creates the required execution root before a measured block', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-confirmation-layout-'));
  try {
    await createExecutionRoot(root);
    assert.equal((await stat(join(root, 'executions'))).isDirectory(), true);
    await assert.rejects(createExecutionRoot(root), /EEXIST/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('live-block Jev credential smoke requires real model and usage metadata before Codex', async () => {
  const good = async (_state, questions) => ({
    model: 'jev-1.13.0', usage: { input_tokens: 12, output_tokens: 3 },
    answers: Object.fromEntries(Object.keys(questions).map(key => [key, { noul: key.endsWith('_0') ? 0.99 : 0.01 }])),
  });
  const smoke = await jevCredentialSmoke(undefined, good);
  assert.equal(smoke.mode, 'jev');
  assert.equal(smoke.model, 'jev-1.13.0');
  assert.equal(smoke.requests, 1);
  assert.deepEqual(smoke.usage, { input_tokens: 12, output_tokens: 3 });
  assert.ok(Number.isInteger(smoke.latencyMs));
  await assert.rejects(jevCredentialSmoke(undefined, async (_state, questions) => ({
    model: 'wrong', usage: { input_tokens: 12, output_tokens: 3 },
    answers: Object.fromEntries(Object.keys(questions).map(key => [key, { noul: 0.5 }])),
  })), /incomplete model or usage telemetry/);
});

test('credential preflight may retry safely only before any Codex launch', () => {
  const block = { status: 'pending', launches: 0, preflightAttempts: 0 };
  assert.equal(reservePreflightAttempt(block), 1);
  assert.equal(reservePreflightAttempt(block), 2);
  assert.equal(reservePreflightAttempt(block), 3);
  assert.throws(() => reservePreflightAttempt(block), /cap reached/);
  assert.throws(() => reservePreflightAttempt({ status: 'running', launches: 1, preflightAttempts: 0 }), /before a block launches/);
});
