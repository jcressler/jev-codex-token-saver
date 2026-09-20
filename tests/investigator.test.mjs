import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildJevRankingRequest, compactInvestigation, investigate, rankWithJev, searchWorkspace } from '../src/investigator.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jev-token-saver-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'src', 'checkout.ts'), [
    'export function initializeCheckout(config) {',
    '  if (!config.apiKey) throw new Error("missing checkout api key");',
    '  return startCheckout(config);',
    '}',
  ].join('\n'));
  await writeFile(join(root, 'src', 'unrelated.ts'), 'export const checkoutColor = "green";\n');
  await writeFile(join(root, '.env'), 'TYPESAFE_API_KEY=PRIVATE_VALUE\n');
  await writeFile(join(root, 'node_modules', 'noise.js'), 'missing checkout api key PRIVATE_DEPENDENCY\n');
  return root;
}

test('search stays local, bounded, and excludes sensitive or generated files', async () => {
  const root = await fixture();
  try {
    const result = await searchWorkspace(root, 'checkout initialization missing api key', ['failing call site'], { candidateLimit: 10 });
    assert.equal(result.candidates[0].path, 'src/checkout.ts');
    assert.equal(result.candidates.some((candidate) => candidate.excerpt.includes('PRIVATE_VALUE')), false);
    assert.equal(result.candidates.some((candidate) => candidate.excerpt.includes('PRIVATE_DEPENDENCY')), false);
    assert.equal(result.metrics.skippedSensitive, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('search includes a bounded local file referenced by a strong lexical candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-token-saver-reference-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'catalog.mjs'), "import { readPrice } from './cache.mjs';\nexport const catalog = tenant => readPrice(tenant);\n");
    await writeFile(join(root, 'src', 'cache.mjs'), 'const values = new Map();\nexport function readPrice(id) { return values.get(id); }\n');
    await writeFile(join(root, 'notes.md'), 'catalog tenant pricing catalog tenant pricing\n');
    const result = await searchWorkspace(root, 'catalog tenant pricing', [], { candidateLimit: 2, resultLimit: 2, referenceLimit: 1 });
    assert.equal(result.candidates.some(candidate => candidate.path === 'src/cache.mjs'), true);
    assert.equal(result.metrics.referencedCandidatesAdded, 1);
    assert.equal(result.candidates.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace search considers relative paths as evidence signals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-token-saver-path-signal-'));
  try {
    await mkdir(join(root, '.codex-plugin'));
    await writeFile(join(root, '.codex-plugin', 'plugin.json'), '{"name":"example"}\n');
    const result = await searchWorkspace(root, 'codex plugin manifest', [], { candidateLimit: 4, resultLimit: 2 });
    assert.equal(result.candidates.some(candidate => candidate.path === '.codex-plugin/plugin.json'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Jev typed scores can select a lower lexical candidate', async () => {
  const candidates = [
    { path: 'a.ts', lines: { start: 1, end: 1 }, excerpt: 'shared term only', matchedTerms: ['shared'], localScore: 200 },
    { path: 'b.ts', lines: { start: 1, end: 1 }, excerpt: 'the causal evidence', matchedTerms: ['evidence'], localScore: 100 },
  ];
  const ranked = await rankWithJev('shared failure', ['causal evidence'], candidates, {
    resultLimit: 1,
    ask: async (_state, questions) => {
      assert.ok(questions.relevance_0);
      assert.ok(questions.requirement_0_1);
      return {
        model: 'synthetic-jev',
        answers: {
          relevance_0: { noul: 0.4 },
          relevance_1: { noul: 0.9 },
          requirement_0_0: { noul: 0.1 },
          requirement_0_1: { noul: 0.95 },
        },
        usage: { input_tokens: 100, output_tokens: 8 },
      };
    },
  });
  assert.equal(ranked.selected[0].candidate.path, 'b.ts');
  assert.equal(ranked.requests, 1);
  assert.deepEqual(ranked.usage, { input_tokens: 100, output_tokens: 8 });
});

test('coverage selection keeps one all-requirements candidate and a useful relevant complement', async () => {
  const candidates = [
    { path: 'a.ts', lines: { start: 1, end: 1 }, excerpt: 'covers both requirements', matchedTerms: [], localScore: 1 },
    { path: 'b.ts', lines: { start: 1, end: 1 }, excerpt: 'weak repeated evidence', matchedTerms: [], localScore: 100 },
    { path: 'c.ts', lines: { start: 1, end: 1 }, excerpt: 'relevant complementary evidence', matchedTerms: [], localScore: 2 },
  ];
  const ranked = await rankWithJev('investigate the failure', ['cause', 'fallback'], candidates, {
    resultLimit: 2,
    ask: async () => ({
      answers: {
        relevance_0: { noul: 0.82 }, relevance_1: { noul: 0.31 }, relevance_2: { noul: 0.97 },
        requirement_0_0: { noul: 0.91 }, requirement_1_0: { noul: 0.88 },
        requirement_0_1: { noul: 0.49 }, requirement_1_1: { noul: 0.42 },
        requirement_0_2: { noul: 0.72 }, requirement_1_2: { noul: 0.49 },
      },
    }),
  });
  assert.deepEqual(ranked.selected.map(item => item.candidate.path), ['a.ts', 'c.ts']);
});

test('Jev selection abstains when no candidate meets the declared usefulness threshold', async () => {
  const ranked = await rankWithJev('investigate the failure', ['cause'], [
    { path: 'weak.ts', lines: { start: 1, end: 1 }, excerpt: 'weak evidence', matchedTerms: [], localScore: 1 },
  ], {
    resultLimit: 3,
    ask: async () => ({
      answers: { relevance_0: { noul: 0.49 }, requirement_0_0: { noul: 0.99 } },
    }),
  });
  assert.deepEqual(ranked.selected, []);
});

test('requirement scores guide coverage without vetoing relevant evidence', async () => {
  const ranked = await rankWithJev('investigate the failure', ['optional supporting detail'], [
    { path: 'cause.ts', lines: { start: 1, end: 1 }, excerpt: 'directly relevant cause', matchedTerms: [], localScore: 1 },
  ], {
    resultLimit: 1,
    ask: async () => ({
      answers: { relevance_0: { noul: 0.81 }, requirement_0_0: { noul: 0.22 } },
    }),
  });
  assert.deepEqual(ranked.selected.map(item => item.candidate.path), ['cause.ts']);
});

test('HTTP Jev responses require returned model and usage metadata', async () => {
  const originalFetch = globalThis.fetch;
  const candidate = { path: 'a.ts', lines: { start: 1, end: 1 }, excerpt: 'evidence', matchedTerms: [], localScore: 1 };
  const answers = { relevance_0: { noul: 0.9 } };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      model: 'jev-1.13.0', answers, usage: { input_tokens: 12, output_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const ranked = await rankWithJev('query', [], [candidate], { apiKey: 'offline-test-key' });
    assert.equal(ranked.model, 'jev-1.13.0');
    assert.deepEqual(ranked.usage, { input_tokens: 12, output_tokens: 3 });

    for (const responseBody of [
      { answers, usage: { input_tokens: 12, output_tokens: 3 } },
      { model: 'jev-1.13.0', answers },
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(responseBody), { status: 200 });
      await assert.rejects(
        rankWithJev('query', [], [candidate], { apiKey: 'offline-test-key' }),
        /Jev response is missing (model|valid usage)/,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ranking request is bounded below 48 KiB', () => {
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    path: `src/file-${index}.ts`,
    excerpt: 'relevant evidence '.repeat(200),
  }));
  const request = buildJevRankingRequest('find relevant evidence', Array.from({ length: 6 }, (_, index) => `requirement ${index}`), candidates);
  assert.ok(request.bytes <= 48 * 1024);
  assert.equal(request.state.candidates.length, 20);
});

test('investigation reports packet reduction without calling it Codex savings', async () => {
  const root = await fixture();
  try {
    const result = await investigate({ root, query: 'checkout', candidateLimit: 2, resultLimit: 1 });
    assert.equal(result.mode, 'local');
    assert.equal(result.evidence.length, 1);
    assert.ok(result.metrics.candidateContextReductionPercent > 0);
    assert.match(result.measurementNote, /not an end-to-end Codex token measurement/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compact investigation keeps evidence and essential warnings while omitting diagnostics', () => {
  const compact = compactInvestigation({
    mode: 'local-fallback', query: 'repeated query', root: 'C:/private/root', jevModel: 'jev-1.13.0',
    evidence: [{ path: 'src/a.mjs', lines: { start: 2, end: 3 }, excerpt: '2: evidence', jevRelevance: 0.9 }],
    metrics: { scanTruncated: true, elapsedMs: 25, jevUsage: { input_tokens: 20 } }, warning: 'synthetic outage',
  });
  assert.deepEqual(compact.evidence, [{ path: 'src/a.mjs', lines: { start: 2, end: 3 }, excerpt: '2: evidence' }]);
  assert.equal('query' in compact, false);
  assert.equal('metrics' in compact, false);
  assert.equal('jevRelevance' in compact.evidence[0], false);
  assert.match(compact.warnings.join(' '), /local fallback/);
  assert.match(compact.warnings.join(' '), /scan reached/);
});

test('Jev failure falls back to deterministic evidence and is visible', async () => {
  const root = await fixture();
  try {
    let expectedRequestChars = 0;
    const result = await investigate({
      root,
      query: 'checkout',
      useJev: true,
      allowNetwork: true,
      ask: async (state, questions) => {
        expectedRequestChars = Buffer.byteLength(JSON.stringify({ state, questions }), 'utf8');
        throw new Error('synthetic outage');
      },
    });
    assert.equal(result.mode, 'local-fallback');
    assert.equal(result.metrics.jevRequests, 1);
    assert.ok(expectedRequestChars > 0);
    assert.equal(result.metrics.jevRequestChars, expectedRequestChars);
    assert.equal(result.warning, 'synthetic outage');
    assert.ok(result.evidence.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Jev authentication and malformed answers fail visibly with request accounting', async () => {
  const root = await fixture();
  try {
    const authentication = await investigate({
      root, query: 'checkout', useJev: true, allowNetwork: true,
      ask: async () => { throw new Error('Jev request failed (401)'); },
    });
    assert.equal(authentication.mode, 'local-fallback');
    assert.equal(authentication.warning, 'Jev request failed (401)');
    assert.ok(authentication.metrics.jevRequestChars > 0);

    const malformed = await investigate({
      root, query: 'checkout', useJev: true, allowNetwork: true,
      ask: async () => ({ answers: {} }),
    });
    assert.equal(malformed.mode, 'local-fallback');
    assert.match(malformed.warning, /invalid Jev answer/);
    assert.ok(malformed.metrics.jevRequestChars > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
