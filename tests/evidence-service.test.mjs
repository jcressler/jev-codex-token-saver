import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildTextCandidates, readLargeTextEvidence, readSelectedEvidence, searchWorkspaceEvidence } from '../src/evidence-service.mjs';

async function tempWorkspace(prefix = 'jev-evidence-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, 'src'), { recursive: true });
  return root;
}

function jevAnswer(selectPredicate) {
  return async (state) => {
    const answers = {};
    state.candidates.forEach((candidate, index) => {
      const selected = selectPredicate(candidate);
      answers[`relevance_${index}`] = { noul: selected ? 0.99 : 0.35 };
      state.requirements.forEach((_requirement, requirementIndex) => {
        answers[`requirement_${requirementIndex}_${index}`] = { noul: selected ? 0.98 : 0.1 };
      });
    });
    return { model: 'synthetic-jev', answers, usage: { input_tokens: 900, output_tokens: 50 } };
  };
}

test('small workspace search bypasses Jev and supports exact follow-up retrieval', async () => {
  const root = await tempWorkspace();
  let called = false;
  try {
    await writeFile(join(root, 'src', 'checkout.ts'), [
      'export function initializeCheckout(config) {',
      '  if (!config.apiKey) throw new Error("missing checkout api key");',
      '  return startCheckout(config);',
      '}',
    ].join('\n'));
    const result = await searchWorkspaceEvidence({ workspaceRoot: root, query: 'checkout missing api key' }, {
      ask: async () => { called = true; throw new Error('must not be called'); },
    });
    assert.equal(result.mode, 'bypass');
    assert.equal(result.metrics.jevRequests, 0);
    assert.equal(called, false);
    assert.equal(result.evidence[0].path, 'src/checkout.ts');

    const exact = await readSelectedEvidence({ sessionId: result.sessionId, path: 'src/checkout.ts', startLine: 2, endLine: 3 });
    assert.equal(exact.lines.start, 2);
    assert.match(exact.content, /^2: .*missing checkout api key/m);
    assert.doesNotMatch(exact.content, /^1:/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('eligible noisy large text uses Jev and returns the lower-noise causal block', async () => {
  const root = await tempWorkspace('jev-large-');
  try {
    const noise = Array.from({ length: 1_200 }, (_, index) => `INFO request ${index} checkout retry cache status healthy tenant=t${index % 20}`);
    noise.splice(713, 0,
      'ERROR checkout initialization failed for tenant=orchard',
      'Caused by: MissingSigningKeyError: CHECKOUT_SIGNING_KEY was empty',
      '    at loadCheckoutConfig (src/config.ts:88:11)',
      '    at initializeCheckout (src/checkout.ts:41:5)');
    await writeFile(join(root, 'app.log'), noise.join('\n'));

    const result = await readLargeTextEvidence({
      workspaceRoot: root,
      path: 'app.log',
      query: 'why checkout initialization failed',
      requirements: ['root cause and configuration key'],
      resultLimit: 2,
      includeDiagnostics: true,
    }, { ask: jevAnswer((candidate) => candidate.excerpt.includes('CHECKOUT_SIGNING_KEY')) });

    assert.equal(result.mode, 'jev');
    assert.equal(result.metrics.jevRequests, 1);
    assert.equal(result.evidence.some((item) => item.excerpt.includes('CHECKOUT_SIGNING_KEY')), true);
    assert.equal(result.evidence.some((item) => item.excerpt.includes('at loadCheckoutConfig')), true);
    assert.equal(result.diagnostics.model, 'synthetic-jev');
    assert.deepEqual(result.diagnostics.usage, { input_tokens: 900, output_tokens: 50 });
    assert.equal(Number.isInteger(result.diagnostics.latencyMs), true);
    assert.ok(result.diagnostics.scores.length > 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('critical errors and their stack traces survive selection', async () => {
  const root = await tempWorkspace('jev-critical-');
  try {
    const lines = Array.from({ length: 900 }, (_, index) => `DEBUG worker heartbeat task retry ${index}`);
    lines.splice(500, 0,
      'FATAL worker task failed unexpectedly',
      'TypeError: queue client is undefined',
      '    at runWorker (src/worker.ts:55:9)',
      '    at main (src/index.ts:10:1)');
    await writeFile(join(root, 'worker.log'), lines.join('\n'));
    const result = await readLargeTextEvidence({
      workspaceRoot: root,
      path: 'worker.log',
      query: 'worker task retry behavior',
      requirements: ['retry behavior'],
      resultLimit: 2,
    }, { ask: jevAnswer((candidate) => !candidate.excerpt.includes('FATAL')) });
    assert.equal(result.mode, 'jev');
    assert.equal(result.evidence.some((item) => item.critical && item.excerpt.includes('at runWorker')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('identical text blocks are deduplicated exactly', () => {
  const block = Array.from({ length: 36 }, (_, index) => `checkout retry line ${index}`).join('\n');
  const candidates = buildTextCandidates('duplicate.log', `${block}\n${block}`, 'checkout retry');
  const excerpts = candidates.map((item) => item.excerpt.replace(/^\d+: /gm, ''));
  assert.equal(new Set(excerpts).size, excerpts.length);
});

test('Jev failures and malformed answers make one attempt then fall back visibly', async () => {
  const root = await tempWorkspace('jev-fallback-');
  try {
    const lines = Array.from({ length: 1_000 }, (_, index) => `INFO checkout retry evidence item=${index}`);
    await writeFile(join(root, 'failures.log'), lines.join('\n'));
    for (const ask of [
      async () => { throw new Error('synthetic API outage'); },
      async () => ({ model: 'bad', answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }),
    ]) {
      const result = await readLargeTextEvidence({ workspaceRoot: root, path: 'failures.log', query: 'checkout retry evidence' }, { ask });
      assert.equal(result.mode, 'local-fallback');
      assert.equal(result.metrics.jevRequests, 1);
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0], /local fallback/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('path traversal, sensitive files, and unselected follow-ups are rejected', async () => {
  const root = await tempWorkspace('jev-paths-');
  try {
    await writeFile(join(root, 'selected.txt'), 'needle evidence\nsecond line\n');
    await writeFile(join(root, 'other.txt'), 'unselected content\n');
    await writeFile(join(root, '.env'), 'TYPESAFE_API_KEY=never-read\n');
    const result = await searchWorkspaceEvidence({ workspaceRoot: root, query: 'needle evidence' });
    await assert.rejects(readSelectedEvidence({ sessionId: result.sessionId, path: 'other.txt', complete: true }), /not selected/);
    await assert.rejects(readLargeTextEvidence({ workspaceRoot: root, path: '../outside.txt', query: 'anything' }), /inside the workspace root/);
    await assert.rejects(readLargeTextEvidence({ workspaceRoot: root, path: '.env', query: 'anything' }), /sensitive/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
