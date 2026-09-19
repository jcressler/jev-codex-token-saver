import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt, codexArgs, gradeAnswer, parseCodexEvents } from './paired-pilot.mjs';

test('grader requires the full failure telemetry chain', () => {
  const good = gradeAnswer({
    cause: 'rankWithJev constructs the request and knows its bytes before ask performs the failing network call. The investigate catch then hardcodes requestChars to 0, and metrics publishes ranking.requestChars as jevRequestChars.',
    codeLocations: ['src/investigator.mjs:289', 'src/investigator.mjs:350', 'src/investigator.mjs:357', 'src/investigator.mjs:397', 'tests/investigator.test.mjs:87'],
    minimalFix: 'Carry the request byte count across the failure boundary on a typed error and preserve it in the fallback result.',
    testGap: 'Add a test that forces ask to fail and expects jevRequestChars to equal the exact nonzero request size.',
    confidence: 0.99,
  });
  assert.equal(good.score, 10);
  assert.equal(good.passed, true);
  const vague = gradeAnswer({ cause: 'The metric is wrong.', codeLocations: [], minimalFix: 'Fix it.', testGap: 'Add tests.' });
  assert.equal(vague.passed, false);
});

test('grader accepts equivalent wording from the audited stock answer', () => {
  const result = gradeAnswer({
    cause: '`rankWithJev` builds the bounded request and computes its exact UTF-8 size before calling the Jev adapter. If response validation throws, the fallback uses hard-coded `requestChars: 0`. The public `metrics.jevRequestChars` copies `ranking.requestChars`.',
    codeLocations: ['src/investigator.mjs:287', 'src/investigator.mjs:350', 'tests/investigator.test.mjs:87'],
    minimalFix: 'Preserve request bytes across the exception boundary using a typed error carrying the request size into the fallback.',
    testGap: 'Add a test that records the actual size and expects result.metrics.jevRequestChars to equal that positive value.',
    confidence: 0.99,
  });
  assert.equal(result.score, 10);
});

test('grader accepts direct public-metric propagation wording', () => {
  const result = gradeAnswer({
    cause: 'The request size is known before the Jev ask call. The fallback hard-codes requestChars to 0, and the public result copies that zero directly into metrics.jevRequestChars.',
    codeLocations: ['src/investigator.mjs:289', 'src/investigator.mjs:350', 'tests/investigator.test.mjs:87'],
    minimalFix: 'Preserve the request byte size across the failure boundary and carry it into the fallback.',
    testGap: 'Extend the test to expect jevRequestChars to equal the recorded positive request size.',
    confidence: 0.99,
  });
  assert.equal(result.score, 10);
});

test('event parser records usage, answer, and tool failures', () => {
  const stdout = [
    JSON.stringify({ type: 'item.started', item: { id: '1', type: 'command_execution' } }),
    JSON.stringify({ type: 'item.completed', item: { id: '1', type: 'command_execution', exit_code: 1 } }),
    JSON.stringify({ type: 'item.completed', item: { id: '2', type: 'agent_message', text: '{"cause":"x"}' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 } }),
  ].join('\n');
  assert.deepEqual(parseCodexEvents(stdout), {
    usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 },
    finalText: '{"cause":"x"}',
    toolCalls: 1,
    failedToolCalls: 1,
  });
});

test('assisted prompt contains the packet but not the hidden answer', () => {
  const prompt = buildPrompt([{ path: 'src/a.js', lines: { start: 1, end: 2 }, excerpt: 'evidence' }]);
  assert.match(prompt, /bounded evidence packet/);
  assert.match(prompt, /src\/a\.js/);
  assert.doesNotMatch(prompt, /hardcodes requestChars: 0/);
});

test('Codex exec restores never approval policy through a supported config override', () => {
  const args = codexArgs('fixture', 'schema.json', 'prompt');
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('approval_policy="never"'));
  assert.equal(args.includes('-a'), false);
});
