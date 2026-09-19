import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildJevRankingRequest, investigate, rankWithJev, searchWorkspace } from '../src/investigator.mjs';

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

test('Jev failure falls back to deterministic evidence and is visible', async () => {
  const root = await fixture();
  try {
    const result = await investigate({
      root,
      query: 'checkout',
      useJev: true,
      allowNetwork: true,
      ask: async () => { throw new Error('synthetic outage'); },
    });
    assert.equal(result.mode, 'local-fallback');
    assert.equal(result.metrics.jevRequests, 1);
    assert.equal(result.warning, 'synthetic outage');
    assert.ok(result.evidence.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
