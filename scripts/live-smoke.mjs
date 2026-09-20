#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLargeTextEvidence } from '../src/evidence-service.mjs';

if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required');
if (!/^[A-Za-z0-9._-]{20,512}$/.test(process.env.TYPESAFE_API_KEY)) {
  throw new Error('TYPESAFE_API_KEY does not match the documented key format');
}

const root = await mkdtemp(join(tmpdir(), 'jev-token-saver-live-'));
try {
  const lines = Array.from({ length: 8_000 }, (_, index) =>
    `INFO request completed route=/checkout attempt=${index} cache=healthy duration_ms=${20 + (index % 50)}`);
  lines.splice(5_777, 0,
    'ERROR checkout initialization failed tenant=orchard',
    'Caused by: MissingSigningKeyError: CHECKOUT_SIGNING_KEY was empty',
    '    at loadCheckoutConfig (src/config.ts:88:11)',
    '    at initializeCheckout (src/checkout.ts:41:5)');
  await writeFile(join(root, 'application.log'), lines.join('\n'));

  const result = await readLargeTextEvidence({
    workspaceRoot: root,
    path: 'application.log',
    query: 'Why did checkout initialization fail for tenant orchard?',
    requirements: ['Identify the root cause and exact configuration key', 'Preserve the associated stack trace'],
    resultLimit: 3,
    includeDiagnostics: true,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.mode !== 'jev') throw new Error(`live smoke did not use Jev: ${result.mode}; ${result.warnings?.join('; ') ?? 'no warning returned'}`);
  if (!result.evidence.some((item) => item.excerpt.includes('CHECKOUT_SIGNING_KEY'))) throw new Error('live smoke missed the planted root cause');
} finally {
  await rm(root, { recursive: true, force: true });
}
