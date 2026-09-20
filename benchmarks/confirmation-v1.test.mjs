import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readLargeTextEvidence, searchWorkspaceEvidence } from '../src/evidence-service.mjs';
import { ARMS, REPETITIONS, TASKS, createFixtures, gradeAnswer, makePlan, promptLeaksOracle } from './confirmation-v1-tasks.mjs';
import { BLOCK_RUNS, TOTAL_RUNS, codexArgs, createExecutionRoot, evidenceSupportsFrozenFacts, jevCredentialSmoke, mockJev, pairedBootstrap, parseEvents, promptFor, taskInput, toolPolicy } from './confirmation-v1.mjs';

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
  const root = await mkdtemp(join(tmpdir(), 'jev-confirmation-v1-'));
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

test('frozen graders reject an empty or vague answer', () => {
  for (const task of TASKS) {
    const corpus = `${task.query}\n${task.tool === 'read_large_text_evidence' ? JSON.stringify(task.log) : `${Object.keys(task.files).join('\n')}\n${Object.values(task.files).join('\n')}`}\nreplace rotate renew update certificate CA bundle with a positive greater-than-zero valid value; use a decimal string fixed-point BigInt currency library; use attempt < maxAttempts with a strict exclusive bound; rethrow AbortError and do not retry; visibility must exceed and remain longer than runtime; defaults first then environment overrides and only missing values; remove division and keep the same units. Add a regression test asserting two different distinct tenants and organizations, exact bytes, whitespace and property order, 1.005 equals 101, exactly three calls, one call without another retry, redelivery, environment-over-default precedence, and a representative 25-percent distribution.`;
    const reference = { finding: corpus, codeLocations: [corpus], minimalFix: corpus, testGap: corpus, confidence: 1 };
    assert.equal(gradeAnswer(task, reference).passed, true, `${task.id} reference`);
    assert.equal(gradeAnswer(task, { finding: 'There is a bug.', codeLocations: ['src/file.mjs'], minimalFix: 'Fix it.', testGap: 'Test it.' }).passed, false, task.id);
  }
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
