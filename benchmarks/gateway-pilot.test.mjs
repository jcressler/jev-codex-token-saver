import assert from 'node:assert/strict';
import test from 'node:test';
import { TASKS, codexArgs, exactFacts, makeMonitor, parseEvents, plan, toolPolicy } from './gateway-pilot.mjs';

test('gateway pilot freezes six no-retry executions with balanced arms', () => {
  const frozen = plan();
  assert.equal(frozen.length, 6);
  assert.deepEqual(Object.fromEntries(['stock', 'local', 'jev'].map(arm => [arm, frozen.filter(item => item.arm === arm).length])), {
    stock: 2, local: 2, jev: 2,
  });
  assert.equal(new Set(frozen.map(item => item.runId)).size, 6);
});

test('Codex arguments isolate user config and use the exec-supported approval override', () => {
  const task = { toolExtra: {} };
  const stock = codexArgs(task, 'stock', 'fixture', 'schema.json', 'diagnostics', 'prompt');
  const gateway = codexArgs(task, 'local', 'fixture', 'schema.json', 'diagnostics', 'prompt');
  assert.ok(stock.includes('--ignore-user-config'));
  assert.ok(stock.includes('approval_policy="never"'));
  assert.ok(stock.includes('danger-full-access'));
  assert.equal(stock.includes('-a'), false);
  assert.ok(gateway.includes('mcp_servers.jev_token_saver.command="node"'));
  assert.ok(gateway.includes('features.shell_tool=false'));
});

test('task requirements request fact categories without disclosing the oracle', () => {
  const requirements = TASKS.flatMap(task => task.requirements).join('\n');
  for (const leakedAnswer of ['MissingSigningKeyError', 'CHECKOUT_SIGNING_KEY', 'loadCheckoutConfig', 'productId', 'tenantId:productId']) {
    assert.equal(requirements.includes(leakedAnswer), false, `requirements leaked ${leakedAnswer}`);
  }
});

test('event and policy validation require usage and exactly two gateway calls', () => {
  const parsed = parseEvents([
    JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'jev_token_saver', tool: 'search_workspace_evidence' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'jev_token_saver', status: 'completed' } }),
    JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'jev_token_saver', tool: 'read_selected_evidence' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'jev_token_saver', status: 'completed' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"finding":"x"}' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }),
  ].join('\n'));
  assert.equal(parsed.usage.input_tokens, 10);
  const diagnostics = [{ record: { mode: 'jev', metrics: { jevRequests: 1 } } }];
  assert.equal(toolPolicy('jev', parsed, diagnostics).passed, true);
});

test('live monitor allows built-in discovery and stops real policy drift', () => {
  const stock = makeMonitor('stock');
  assert.equal(stock({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'codex', tool: 'list_mcp_resources' } }), undefined);
  assert.match(stock({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'jev_token_saver', tool: 'search_workspace_evidence' } }), /stock arm/);
  const gateway = makeMonitor('jev');
  assert.match(gateway({ type: 'item.started', item: { type: 'command_execution' } }), /command tool/);
});

test('exact fact grading fails closed', () => {
  assert.equal(exactFacts('alpha beta', [/alpha/, /beta/]).passed, true);
  assert.equal(exactFacts('alpha', [/alpha/, /beta/]).passed, false);
});
