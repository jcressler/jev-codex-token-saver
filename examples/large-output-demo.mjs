#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLargeTextEvidence } from '../src/evidence-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'jev-token-saver-demo-'));
try {
  const lines = Array.from({ length: 8_000 }, (_, index) =>
    `INFO request completed route=/checkout attempt=${index} cache=healthy duration_ms=${20 + (index % 50)}`);
  lines.splice(5_777, 0,
    'ERROR checkout initialization failed tenant=orchard',
    'Caused by: MissingSigningKeyError: CHECKOUT_SIGNING_KEY was empty',
    '    at loadCheckoutConfig (src/config.ts:88:11)',
    '    at initializeCheckout (src/checkout.ts:41:5)');
  await writeFile(join(root, 'application.log'), lines.join('\n'));

  const ask = async (state) => {
    const answers = {};
    state.candidates.forEach((candidate, index) => {
      const causal = candidate.excerpt.includes('CHECKOUT_SIGNING_KEY');
      answers[`relevance_${index}`] = { noul: causal ? 0.99 : 0.2 };
      answers[`requirement_0_${index}`] = { noul: causal ? 0.99 : 0.05 };
    });
    return { model: 'synthetic-demo-selector', answers, usage: { input_tokens: 1_200, output_tokens: 80 } };
  };

  const result = await readLargeTextEvidence({
    workspaceRoot: root,
    path: 'application.log',
    query: 'why checkout initialization failed',
    requirements: ['root cause and configuration key'],
    resultLimit: 2,
    includeDiagnostics: true,
  }, { ask });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
