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

    const throughEof = await readSelectedEvidence({ sessionId: result.sessionId, path: 'src/checkout.ts', startLine: 2, endLine: 20 });
    assert.deepEqual(throughEof.lines, { start: 2, end: 4 });
    assert.match(throughEof.content, /^4: }$/m);
    await assert.rejects(
      readSelectedEvidence({ sessionId: result.sessionId, path: 'src/checkout.ts', startLine: 3, endLine: 2 }),
      /greater than or equal to startLine/,
    );
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

test('a targeted second Jev pass can recover an initially omitted source in its own session', async () => {
  const root = await tempWorkspace('jev-recovery-');
  let requests = 0;
  try {
    await Promise.all([
      writeFile(join(root, 'src', 'startup.ts'), [
        'export function startInventory(config) {',
        '  return createInventoryPool(config.poolSize);',
        '}',
        '// inventory pool startup validation configuration',
        ...Array.from({ length: 80 }, (_, index) => `// inventory pool startup trace ${index}`),
      ].join('\n')),
      writeFile(join(root, 'src', 'pool-policy.ts'), [
        'export function createInventoryPool(poolSize) {',
        '  validatePoolSize(poolSize);',
        '  return connectPool(poolSize);',
        '}',
        'export function validatePoolSize(value) {',
        '  if (!Number.isInteger(value)) throw new PoolConfigurationError();',
        '}',
        '// inventory pool startup validation configuration',
        ...Array.from({ length: 80 }, (_, index) => `// pool size validation note ${index}`),
      ].join('\n')),
      ...Array.from({ length: 8 }, (_, fileIndex) => writeFile(
        join(root, 'src', `pool-notes-${fileIndex}.txt`),
        Array.from({ length: 90 }, (_, lineIndex) =>
          `inventory pool startup validation configuration note file=${fileIndex} line=${lineIndex} ` +
          'historical diagnostic context contains no validator implementation or accepted-value contract').join('\n'),
      )),
    ]);

    const ask = async (state) => {
      requests += 1;
      const answers = {};
      state.candidates.forEach((candidate, index) => {
        const select = requests === 1
          ? candidate.path === 'src/startup.ts'
          : candidate.path === 'src/pool-policy.ts';
        answers[`relevance_${index}`] = { noul: select ? 0.99 : 0.1 };
        state.requirements.forEach((_requirement, requirementIndex) => {
          answers[`requirement_${requirementIndex}_${index}`] = { noul: select ? 0.98 : 0.08 };
        });
      });
      return { model: 'synthetic-jev', answers, usage: { input_tokens: 500, output_tokens: 20 } };
    };

    const initial = await searchWorkspaceEvidence({
      workspaceRoot: root,
      query: 'inventory pool startup configuration',
      requirements: ['find the startup call'],
      resultLimit: 1,
    }, { ask });
    assert.equal(initial.mode, 'jev');
    assert.equal(initial.metrics.jevRequests, 1);
    assert.equal(initial.evidence[0].path, 'src/startup.ts');
    await assert.rejects(
      readSelectedEvidence({ sessionId: initial.sessionId, path: 'src/pool-policy.ts', complete: true }),
      /not selected/,
    );

    const recovery = await searchWorkspaceEvidence({
      workspaceRoot: root,
      query: 'pool size validation policy',
      requirements: ['find the validator implementation'],
      resultLimit: 1,
    }, { ask });
    assert.equal(recovery.mode, 'jev');
    assert.equal(recovery.metrics.jevRequests, 1);
    assert.equal(requests, 2);
    assert.equal(recovery.evidence[0].path, 'src/pool-policy.ts');
    assert.notEqual(recovery.sessionId, initial.sessionId);

    const exact = await readSelectedEvidence({
      sessionId: recovery.sessionId,
      path: 'src/pool-policy.ts',
      startLine: 1,
      endLine: 8,
    });
    assert.match(exact.content, /validatePoolSize/);
    assert.match(exact.content, /PoolConfigurationError/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('two bounded Jev passes can remain unresolved without exposing weak candidates', async () => {
  const root = await tempWorkspace('jev-recovery-empty-');
  let requests = 0;
  try {
    await Promise.all(Array.from({ length: 8 }, (_, fileIndex) => writeFile(
      join(root, 'src', `unknown-${fileIndex}.txt`),
      Array.from({ length: 100 }, (_, lineIndex) =>
        `inventory pool validation unknown file=${fileIndex} line=${lineIndex} ` +
        'historical diagnostic context contains no accepted value contract or validator source').join('\n'),
    )));
    const ask = async (state) => {
      requests += 1;
      const answers = {};
      state.candidates.forEach((_candidate, index) => {
        answers[`relevance_${index}`] = { noul: 0.1 };
        state.requirements.forEach((_requirement, requirementIndex) => {
          answers[`requirement_${requirementIndex}_${index}`] = { noul: 0.1 };
        });
      });
      return { model: 'synthetic-jev', answers, usage: { input_tokens: 400, output_tokens: 20 } };
    };

    for (const query of ['inventory pool validation', 'missing validator contract']) {
      const result = await searchWorkspaceEvidence({
        workspaceRoot: root,
        query,
        requirements: ['find the accepted value contract'],
      }, { ask });
      assert.equal(result.mode, 'jev');
      assert.equal(result.metrics.jevRequests, 1);
      assert.deepEqual(result.evidence, []);
    }
    assert.equal(requests, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an empty initial Jev result can recover evidence with a changed missing-fact query', async () => {
  const root = await tempWorkspace('jev-recovery-from-empty-');
  let requests = 0;
  try {
    const lines = Array.from({ length: 1_200 }, (_, index) =>
      `inventory startup evidence pool validator contract historical note item=${index}`);
    lines.splice(730, 0,
      'The accepted pool-size contract is implemented by validatePoolSize.',
      'validatePoolSize rejects values that are not integers before pool startup.');
    await writeFile(join(root, 'inventory.log'), lines.join('\n'));

    const ask = async (state) => {
      requests += 1;
      const answers = {};
      state.candidates.forEach((candidate, index) => {
        const select = requests === 2 && candidate.excerpt.includes('accepted pool-size contract');
        answers[`relevance_${index}`] = { noul: select ? 0.99 : 0.1 };
        state.requirements.forEach((_requirement, requirementIndex) => {
          answers[`requirement_${requirementIndex}_${index}`] = { noul: select ? 0.98 : 0.08 };
        });
      });
      return { model: 'synthetic-jev', answers, usage: { input_tokens: 450, output_tokens: 20 } };
    };

    const initial = await readLargeTextEvidence({
      workspaceRoot: root,
      path: 'inventory.log',
      query: 'inventory startup evidence',
      requirements: ['find the direct failure'],
      resultLimit: 2,
    }, { ask });
    assert.equal(initial.mode, 'jev');
    assert.deepEqual(initial.evidence, []);

    const recovery = await readLargeTextEvidence({
      workspaceRoot: root,
      path: 'inventory.log',
      query: 'pool validator contract',
      requirements: ['find the accepted value contract'],
      resultLimit: 2,
    }, { ask });
    assert.equal(recovery.mode, 'jev');
    assert.equal(requests, 2);
    assert.equal(recovery.evidence.some((item) => item.excerpt.includes('accepted pool-size contract')), true);
    assert.notEqual(recovery.sessionId, initial.sessionId);

    const selected = recovery.evidence.find((item) => item.excerpt.includes('accepted pool-size contract'));
    const exact = await readSelectedEvidence({
      sessionId: recovery.sessionId,
      path: selected.path,
      startLine: selected.lines.start,
      endLine: selected.lines.end,
    });
    assert.match(exact.content, /validatePoolSize/);
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
