import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const SEED = 'jev-codex-confirmation-v3-2026-09-19';
export const ARMS = Object.freeze(['stock', 'local', 'jev']);
export const REPETITIONS = 3;

function logTask({ id, query, path, incident, exception, key, firstFrame, secondFrame, fix }) {
  return {
    id, category: 'noisy-log', tool: 'read_large_text_evidence', query, path,
    requirements: [
      'Identify the direct failure and the configuration value responsible.',
      'Report the first two application stack frames with source locations.',
      'State the smallest safe correction and a regression check.',
    ],
    log: { incident, exception, key, firstFrame, secondFrame },
    fix,
    facts: [
      ['finding', new RegExp(escapeRegex(incident), 'i')],
      ['finding', new RegExp(escapeRegex(exception), 'i')],
      ['finding', new RegExp(escapeRegex(key), 'i')],
      ['locations', framePattern(firstFrame)],
      ['locations', framePattern(secondFrame)],
      ['minimalFix', fix],
      ['testGap', /test|regression|assert|simulate|exercise/i],
    ],
  };
}

function workspaceTask(definition) {
  return {
    category: definition.category,
    tool: 'search_workspace_evidence',
    requirements: [
      'Identify the exact causal path rather than a nearby symptom.',
      'Name the source and test or configuration locations that establish the cause.',
      'State the minimal safe fix and the regression test that proves it.',
    ],
    ...definition,
  };
}

export const TASKS = Object.freeze([
  logTask({
    id: 'pricing-feed-token-incident',
    query: 'Investigate pricing incident PRC-8044 and identify the direct startup failure, the responsible configuration, and the first two application frames.',
    path: 'logs/pricing.log', incident: 'PRC-8044', exception: 'FeedTokenConfigurationError', key: 'PRICING_FEED_TOKEN',
    firstFrame: ['loadPricingFeedPolicy', 'src/pricing-policy.ts:83:11'], secondFrame: ['startPricingFeed', 'src/pricing-worker.ts:152:7'],
    fix: /(?:set|replace|restore|configure)[\s\S]*(?:PRICING_FEED_TOKEN|feed token)|(?:PRICING_FEED_TOKEN|feed token)[\s\S]*(?:set|replace|restore|configure)/i,
  }),
  logTask({
    id: 'inventory-pool-incident',
    query: 'Investigate inventory incident INV-3307 and identify the direct startup failure, the responsible configuration, and the first two application frames.',
    path: 'logs/inventory.log', incident: 'INV-3307', exception: 'PoolConfigurationError', key: 'INVENTORY_DB_POOL_SIZE',
    firstFrame: ['createInventoryPool', 'src/db.ts:119:13'], secondFrame: ['startInventorySync', 'src/sync.ts:207:5'],
    fix: /positive|greater than zero|nonzero|valid[\s\S]*(?:INVENTORY_DB_POOL_SIZE|pool size)|(?:INVENTORY_DB_POOL_SIZE|pool size)[\s\S]*(?:positive|greater than zero|nonzero|valid)/i,
  }),
  logTask({
    id: 'catalog-batch-incident',
    query: 'Investigate catalog incident CAT-6721 and identify the direct indexing failure, the responsible configuration, and the first two application frames.',
    path: 'logs/catalog.log', incident: 'CAT-6721', exception: 'BatchSizeConfigurationError', key: 'CATALOG_INDEX_BATCH_SIZE',
    firstFrame: ['loadIndexBatchPolicy', 'src/index-policy.ts:58:9'], secondFrame: ['startCatalogIndexer', 'src/catalog-indexer.ts:131:5'],
    fix: /positive|greater than zero|nonzero|valid[\s\S]*(?:CATALOG_INDEX_BATCH_SIZE|batch size)|(?:CATALOG_INDEX_BATCH_SIZE|batch size)[\s\S]*(?:positive|greater than zero|nonzero|valid)/i,
  }),
  workspaceTask({
    id: 'webhook-byte-verification', category: 'large-repository',
    query: 'Why do valid delivery webhooks fail HMAC verification when harmless JSON whitespace or property order changes? Find the causal code path and minimal safe fix.',
    requirements: [
      'Trace the original request body through parsing and signature verification.',
      'Compare the provider-signed bytes with the value passed into HMAC verification.',
      'State the safe verification order and regression coverage for byte-distinct JSON.',
    ],
    noiseTerms: 'webhook delivery JSON signature request verification body provider',
    files: {
      'src/http/body-parser.mjs': `export function parseWebhookBody(rawBody) {\n  return JSON.parse(rawBody.toString('utf8'));\n}\n`,
      'src/webhooks/verify.mjs': `import { createHmac, timingSafeEqual } from 'node:crypto';\n\nexport function verifyDeliverySignature(parsedBody, signature, secret) {\n  const normalized = JSON.stringify(parsedBody);\n  const expected = createHmac('sha256', secret).update(normalized).digest();\n  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));\n}\n`,
      'src/webhooks/route.mjs': `import { parseWebhookBody } from '../http/body-parser.mjs';\nimport { verifyDeliverySignature } from './verify.mjs';\n\nexport function receiveDelivery(rawBody, signature, secret) {\n  const parsed = parseWebhookBody(rawBody);\n  if (!verifyDeliverySignature(parsed, signature, secret)) throw new Error('invalid signature');\n  return parsed;\n}\n`,
      'tests/webhook-signature.test.mjs': `// Covers compact JSON only. Missing cases: whitespace and alternate property order.\n`,
      'docs/provider-contract.md': `The provider signs the exact request bytes before transmission. JSON semantics do not replace byte identity for HMAC verification.\n`,
    },
    facts: [
      ['finding', /JSON\.parse|parsed body|parsing/i], ['finding', /JSON\.stringify|reserial|normaliz/i],
      ['finding', /HMAC|signature/i], ['finding', /raw|original|exact[\s-]*bytes/i],
      ['locations', /src[\\/]http[\\/]body-parser\.mjs/i], ['locations', /src[\\/]webhooks[\\/]verify\.mjs/i],
      ['minimalFix', /verify[\s\S]*(?:raw|original|exact)[\s-]*(?:body|bytes)|(?:raw|original|exact)[\s-]*(?:body|bytes)[\s\S]*verify/i],
      ['testGap', /whitespace|property order|byte/i],
    ],
  }),
  workspaceTask({
    id: 'session-cache-region-scope', category: 'large-repository',
    query: 'Why can a session loaded in one deployment region be reused in another region when session IDs collide? Find the causal path and minimal safe fix.',
    noiseTerms: 'session authentication deployment region identity cache response',
    files: {
      'src/sessions/cache.mjs': `const sessions = new Map();\n\nexport function readSession(regionId, sessionId) {\n  return sessions.get(sessionId);\n}\n\nexport function writeSession(regionId, sessionId, session) {\n  sessions.set(sessionId, session);\n}\n`,
      'src/sessions/load.mjs': `import { readSession, writeSession } from './cache.mjs';\n\nexport async function loadSession(regionId, sessionId, fetchSession) {\n  const prior = readSession(regionId, sessionId);\n  if (prior) return prior;\n  const session = await fetchSession(regionId, sessionId);\n  writeSession(regionId, sessionId, session);\n  return session;\n}\n`,
      'tests/session-cache.test.mjs': `// Repeated reads in one region are covered. Cross-region session ID collisions are not covered.\n`,
      'docs/session-identity.md': `Session IDs are unique only within a deployment region. Cache identity must include regionId and sessionId.\n`,
    },
    facts: [
      ['finding', /sessionId|session ID/i], ['finding', /regionId|region/i], ['finding', /sessions?\.(?:get|set)\(sessionId\)|(?:key|index|map|store)[\s\S]*(?:only|solely|alone|just)[\s\S]*session/i],
      ['finding', /return|reuse|prior|cached/i], ['locations', /src[\\/]sessions[\\/]cache\.mjs/i], ['locations', /src[\\/]sessions[\\/]load\.mjs/i],
      ['minimalFix', /region[\s\S]*session|session[\s\S]*region/i], ['testGap', /two|different|distinct|cross-region/i],
    ],
  }),
  workspaceTask({
    id: 'permission-cache-org-scope', category: 'large-repository',
    query: 'Why can permissions loaded for one organization be reused in another organization for the same user? Find the causal path and minimal safe fix.',
    noiseTerms: 'permission authorization organization user cache policy role',
    files: {
      'src/auth/permission-cache.mjs': `const permissionCache = new Map();\n\nexport function readPermissions(orgId, userId) {\n  return permissionCache.get(userId);\n}\n\nexport function writePermissions(orgId, userId, permissions) {\n  permissionCache.set(userId, permissions);\n}\n`,
      'src/auth/authorize.mjs': `import { readPermissions, writePermissions } from './permission-cache.mjs';\n\nexport async function authorize(orgId, userId, action, load) {\n  let permissions = readPermissions(orgId, userId);\n  if (!permissions) { permissions = await load(orgId, userId); writePermissions(orgId, userId, permissions); }\n  return permissions.includes(action);\n}\n`,
      'tests/authorize.test.mjs': `// One organization per user is covered. Organization switching is absent.\n`,
      'docs/security-boundary.md': `Permission decisions are scoped by organization and user. Both identifiers form the cache identity.\n`,
    },
    facts: [
      ['finding', /userId|user/i], ['finding', /orgId|organi[sz]ation/i], ['finding', /permissionCache\.(?:get|set)\(userId\)|(?:key|index|map|store)[\s\S]*(?:only|solely|alone|just)[\s\S]*user/i],
      ['finding', /cache|reuse|cached|later|another organization/i], ['locations', /src[\\/]auth[\\/]permission-cache\.mjs/i], ['locations', /src[\\/]auth[\\/]authorize\.mjs/i],
      ['minimalFix', /organi[sz]ation[\s\S]*user|user[\s\S]*organi[sz]ation/i], ['testGap', /two|different|distinct|switch[\s-]*org/i],
    ],
  }),
  workspaceTask({
    id: 'currency-rounding-regression', category: 'failing-test',
    query: 'Why does the money conversion regression turn 1.005 dollars into 100 cents instead of 101? Find the causal expression and minimal safe fix.',
    noiseTerms: 'money currency amount cents rounding conversion price',
    files: {
      'src/money/cents.mjs': `export function dollarsToCents(amount) {\n  return Math.round(amount * 100);\n}\n`,
      'src/checkout/total.mjs': `import { dollarsToCents } from '../money/cents.mjs';\nexport const checkoutTotal = lines => lines.reduce((sum, line) => sum + dollarsToCents(line.price), 0);\n`,
      'tests/money.test.mjs': `// Existing integers pass. Regression: dollarsToCents(1.005) must equal 101.\n`,
      'docs/money.md': `Currency conversion must use decimal-safe parsing. Binary floating-point multiplication is not a monetary rounding boundary.\n`,
    },
    facts: [
      ['finding', /Math\.round\(amount \* 100\)|multiply|binary floating[\s-]*point/i], ['finding', /1\.005/i], ['finding', /100|101/i],
      ['locations', /src[\\/]money[\\/]cents\.mjs/i], ['locations', /tests[\\/]money\.test\.mjs/i],
      ['minimalFix', /decimal|string|currency library|fixed[\s-]*point|BigInt/i], ['testGap', /1\.005[\s\S]*101|101[\s\S]*1\.005/i],
    ],
  }),
  workspaceTask({
    id: 'retry-max-attempts-regression', category: 'failing-test',
    query: 'Why does the retry helper execute four calls when maxAttempts is three? Find the causal condition and minimal safe fix.',
    requirements: [
      'Trace maxAttempts through the loop condition and terminal throw boundary.',
      'Reconcile the observed call count with the documented total-attempt contract.',
      'State the smallest bound correction and an exact call-count regression test.',
    ],
    noiseTerms: 'retry attempts request failure backoff network maximum',
    files: {
      'src/network/retry.mjs': `export async function withRetry(operation, maxAttempts) {\n  let attempt = 0;\n  while (attempt <= maxAttempts) {\n    try { return await operation(attempt); }\n    catch (error) {\n      attempt += 1;\n      if (attempt > maxAttempts) throw error;\n    }\n  }\n}\n`,
      'tests/retry.test.mjs': `// Regression: maxAttempts=3 with permanent failure must call the operation exactly three times.\n`,
      'docs/retry-contract.md': `maxAttempts is the total number of calls, including the initial call. It is not a retry count.\n`,
    },
    facts: [
      ['finding', /attempt <= maxAttempts|less[\s-]*than[\s-]*or[\s-]*equal|inclusive/i], ['finding', /four|4/i], ['finding', /three|3/i],
      ['locations', /src[\\/]network[\\/]retry\.mjs/i], ['locations', /tests[\\/]retry\.test\.mjs/i],
      ['minimalFix', /attempt < maxAttempts|strict(?:ly)? less|exclusive/i], ['testGap', /exactly three|three calls|call count/i],
    ],
  }),
  workspaceTask({
    id: 'abort-retry-regression', category: 'failing-test',
    query: 'Why does a cancelled fetch continue retrying instead of stopping immediately? Find the swallowed control-flow signal and minimal safe fix.',
    noiseTerms: 'fetch request retry abort cancellation error signal network',
    files: {
      'src/network/fetch-retry.mjs': `export async function fetchWithRetry(fetcher, signal, retries = 2) {\n  for (let attempt = 0; attempt <= retries; attempt += 1) {\n    try { return await fetcher({ signal }); }\n    // Cancellation currently enters this catch and continues the retry loop.\n    catch (error) {\n      if (attempt === retries) throw error;\n      await new Promise(resolve => setTimeout(resolve, 10));\n    }\n  }\n}\n`,
      'tests/fetch-retry.test.mjs': `// Network errors retry. Missing regression: AbortError must be rethrown without another fetch call.\n`,
      'docs/cancellation.md': `AbortError is a caller control-flow signal, not a transient network failure. Retrying it violates cancellation.\n`,
    },
    facts: [
      ['finding', /catch|caught/i], ['finding', /AbortError|abort/i], ['finding', /retry|another fetch|continue/i],
      ['locations', /src[\\/]network[\\/]fetch-retry\.mjs/i], ['locations', /tests[\\/]fetch-retry\.test\.mjs/i],
      ['minimalFix', /rethrow|throw[\s\S]*AbortError|AbortError[\s\S]*throw|do not retry/i], ['testGap', /one|once|no additional|without another/i],
    ],
  }),
  workspaceTask({
    id: 'queue-visibility-contract', category: 'mixed-doc-config',
    query: 'Why are completed export jobs sometimes delivered twice? Reconcile the queue configuration with the documented handler runtime and identify the minimal safe correction.',
    noiseTerms: 'queue worker job export visibility timeout delivery handler runtime',
    files: {
      'config/export-queue.json': `{\n  "queue": "exports",\n  "visibilityTimeoutSeconds": 30,\n  "maxReceiveCount": 5\n}\n`,
      'src/workers/export-handler.mjs': `export async function handleExport(job) {\n  return job.renderAllPages({ maximumRuntimeSeconds: 90 });\n}\n`,
      'docs/export-worker.md': `The export handler can legitimately run for 90 seconds. Queue visibility must exceed the maximum handler runtime plus operational margin.\n`,
      'tests/export-worker.test.mjs': `// Completion is tested; redelivery after visibility expiration is not.\n`,
    },
    facts: [
      ['finding', /30/i], ['finding', /90/i], ['finding', /visibility/i], ['finding', /redeliver|delivered twice|duplicate|visible again/i],
      ['locations', /config[\\/]export-queue\.json/i], ['locations', /docs[\\/]export-worker\.md|src[\\/]workers[\\/]export-handler\.mjs/i],
      ['minimalFix', /visibility[\s\S]*(?:greater|exceed|above|longer)|(?:greater|exceed|above|longer)[\s\S]*visibility/i], ['testGap', /redeliver|visibility exp|duplicate/i],
    ],
  }),
  workspaceTask({
    id: 'environment-precedence-contract', category: 'mixed-doc-config',
    query: 'Why does the production rate limit remain 60 even when RATE_LIMIT_PER_MINUTE is set to 600? Trace configuration precedence and identify the minimal safe correction.',
    requirements: [
      'Trace the rate-limit value from packaged defaults and the environment into the final configuration.',
      'Identify the assignment order that determines which source wins.',
      'State the minimal precedence correction and a regression test for an explicit environment value.',
    ],
    noiseTerms: 'configuration environment default rate limit production settings precedence',
    files: {
      'config/defaults.json': `{ "RATE_LIMIT_PER_MINUTE": 60, "REQUEST_TIMEOUT_MS": 5000 }\n`,
      'src/config/load.mjs': `import defaults from '../../config/defaults.json' with { type: 'json' };\n\nexport function loadConfig(environment) {\n  const config = { ...environment };\n  for (const [key, value] of Object.entries(defaults)) config[key] = value;\n  return config;\n}\n`,
      'src/server/start.mjs': `import { loadConfig } from '../config/load.mjs';\nexport const start = environment => ({ rateLimit: Number(loadConfig(environment).RATE_LIMIT_PER_MINUTE) });\n`,
      'docs/configuration.md': `Environment variables override packaged defaults. Production sets RATE_LIMIT_PER_MINUTE=600.\n`,
      'tests/config.test.mjs': `// Defaults are tested. Environment-over-default precedence is not tested.\n`,
    },
    facts: [
      ['finding', /60/i], ['finding', /600/i], ['finding', /default/i], ['finding', /environment|env/i], ['finding', /after|overwrite|override|precedence/i],
      ['locations', /src[\\/]config[\\/]load\.mjs/i], ['locations', /config[\\/]defaults\.json|docs[\\/]configuration\.md/i],
      ['minimalFix', /defaults?[\s\S]*(?:first|before)[\s\S]*(?:environment|env)|(?:environment|env)[\s\S]*(?:override|win|last)|only[\s\S]*missing/i],
      ['testGap', /environment[\s-]*over[\s-]*default|precedence|600/i],
    ],
  }),
  workspaceTask({
    id: 'rollout-unit-contract', category: 'mixed-doc-config',
    query: 'Why does a checkout rollout configured for 25 percent reach only about 0.25 percent of users? Reconcile the documented units with the evaluator and identify the minimal safe correction.',
    requirements: [
      'Compare the documented percentage unit with the range produced for each user.',
      'Identify the conversion that places the configured threshold and random value on different scales.',
      'State one consistent unit contract and a representative distribution regression test.',
    ],
    noiseTerms: 'feature flag rollout percentage checkout user evaluation configuration',
    files: {
      'config/features.json': `{ "checkoutPercent": 25 }\n`,
      'src/features/rollout.mjs': `export function enabledForUser(checkoutPercent, randomValue) {\n  const threshold = checkoutPercent / 100;\n  return randomValue < threshold;\n}\n\nexport function seededPercent(userId) {\n  return Number.parseInt(userId.slice(-2), 16) % 100;\n}\n`,
      'src/features/checkout.mjs': `import { enabledForUser, seededPercent } from './rollout.mjs';\nexport const checkoutEnabled = (config, userId) => enabledForUser(config.checkoutPercent, seededPercent(userId));\n`,
      'docs/feature-flags.md': `Rollout values use whole percentage points from 0 through 100. checkoutPercent=25 means approximately twenty-five percent of users.\n`,
      'tests/rollout.test.mjs': `// Zero and 100 are covered. A representative 25-percent distribution is not covered.\n`,
    },
    facts: [
      ['finding', /25/i], ['finding', /0\.25|quarter of one percent|0\.25 percent|checkoutPercent\s*\/\s*100|25\s*\/\s*100/i], ['finding', /divide|\/ 100|threshold/i], ['finding', /0(?: through| to|-)100|whole percentage|seededPercent/i],
      ['locations', /src[\\/]features[\\/]rollout\.mjs/i], ['locations', /docs[\\/]feature-flags\.md|config[\\/]features\.json/i],
      ['minimalFix', /do not divide|remove[\s\S]*(?:\/ 100|division)|same units|normalize[\s\S]*random/i], ['testGap', /25[\s-]*percent|distribution|representative/i],
    ],
  }),
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function framePattern([symbol, location]) {
  return new RegExp(`${escapeRegex(symbol)}[^\\n]*${escapeRegex(location)}|${escapeRegex(location)}[^\\n]*${escapeRegex(symbol)}`, 'i');
}

function fieldText(answer, field) {
  if (field === 'locations') return Array.isArray(answer?.codeLocations) ? answer.codeLocations.join('\n') : '';
  return typeof answer?.[field] === 'string' ? answer[field] : '';
}

export function gradeAnswer(task, answer) {
  const facts = task.facts.map(([field, pattern]) => pattern.test(fieldText(answer, field)));
  return { score: facts.filter(Boolean).length / facts.length, facts, passed: facts.every(Boolean) };
}

export function promptLeaksOracle(task) {
  const promptMaterial = `${task.query}\n${task.requirements.join('\n')}`;
  const sensitive = task.id.includes('incident')
    ? [task.log.exception, task.log.key, ...task.log.firstFrame, ...task.log.secondFrame]
    : Object.keys(task.files).filter(path => path.startsWith('src/') || path.startsWith('config/'));
  return sensitive.filter(value => promptMaterial.toLowerCase().includes(value.toLowerCase()));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function logLine(task, block, row) {
  const services = ['checkout', 'catalog', 'search', 'worker', 'metrics', 'shipping'];
  return `2026-09-19T${String((block + 7) % 24).padStart(2, '0')}:${String(row).padStart(2, '0')}:00.000Z INFO service=${services[block % services.length]} request=req-${task.id}-${block}-${row} status=healthy latency_ms=${20 + row} deployment=stable`;
}

async function createLog(root, task) {
  const lines = [];
  for (let block = 0; block < 24; block += 1) {
    for (let row = 0; row < 34; row += 1) lines.push(logLine(task, block, row));
    lines.push(`2026-09-19T08:${String(block).padStart(2, '0')}:35.000Z WARN probe=${block} configuration validation completed with ordinary transient warning status=recovered`);
  }
  const { incident, exception, key, firstFrame, secondFrame } = task.log;
  lines.push(
    `2026-09-19T12:14:03.201Z ERROR incident=${incident} operation failed during initialization`,
    `Caused by: ${exception}: ${key} is invalid`,
    `    at ${firstFrame[0]} (${firstFrame[1]})`,
    `    at ${secondFrame[0]} (${secondFrame[1]})`,
    `2026-09-19T12:14:03.207Z ERROR incident=${incident} operation aborted before external side effects`,
  );
  for (let block = 24; block < 48; block += 1) {
    for (let row = 0; row < 34; row += 1) lines.push(logLine(task, block, row));
    lines.push(`2026-09-19T13:${String(block % 60).padStart(2, '0')}:35.000Z WARN historical incident probe status=healthy rotation=${block}`);
  }
  await writeTree(root, { [task.path]: `${lines.join('\n')}\n`, 'docs/runbook.md': 'Investigate the exact incident, direct exception, configuration value, and first application frames before proposing a bounded correction.\n' });
}

async function createWorkspace(root, task) {
  await writeTree(root, task.files);
  const terms = task.noiseTerms;
  const ignored = new Set(['why', 'does', 'when', 'their', 'another', 'instead', 'about', 'find', 'identify', 'minimal', 'safe']);
  const nearbyTerms = (task.query.toLowerCase().match(/[a-z0-9_-]{4,}/g) ?? []).filter(term => !ignored.has(term)).slice(0, 2).join(' ');
  for (let index = 0; index < 180; index += 1) {
    const alpha = value => {
      let output = '';
      for (let cursor = value + 1; cursor > 0; cursor = Math.floor((cursor - 1) / 26)) output = String.fromCharCode(97 + ((cursor - 1) % 26)) + output;
      return output.padStart(3, 'a');
    };
    const label = alpha(index);
    const group = `module-${alpha(index % 12)}`;
    const path = `src/${group}/helper-${label}.mjs`;
    const comments = Array.from({ length: 24 }, (_, row) => row % 8 === 0
      ? `// operational note ${row}: ${nearbyTerms} telemetry remains nominal`
      : `// operational note ${row}: routine metrics remain nominal`).join('\n');
    const content = `// Background ${nearbyTerms} helper ${label}.\n// Aggregate telemetry module.\nexport const sample_${label} = { label: '${label}', nominal: true };\n${comments}\n`;
    await writeTree(root, { [path]: content });
  }
}

async function listFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function hashTree(root) {
  const hashes = {};
  for (const path of (await listFiles(root)).sort()) hashes[relative(root, path).replaceAll('\\', '/')] = sha256(await readFile(path));
  return hashes;
}

export async function createFixtures(fixturesRoot) {
  const hashes = {};
  for (const task of TASKS) {
    const root = join(fixturesRoot, task.id);
    await mkdir(root, { recursive: true });
    if (task.tool === 'read_large_text_evidence') await createLog(root, task);
    else await createWorkspace(root, task);
    hashes[task.id] = await hashTree(root);
  }
  return hashes;
}

export function makePlan() {
  const plan = [];
  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    const tasks = [...TASKS].sort((a, b) => sha256(`${SEED}:${repetition}:${a.id}`).localeCompare(sha256(`${SEED}:${repetition}:${b.id}`)));
    tasks.forEach((task, taskIndex) => {
      const rotation = (TASKS.indexOf(task) + repetition - 1) % ARMS.length;
      const order = [...ARMS.slice(rotation), ...ARMS.slice(0, rotation)];
      order.forEach((arm, position) => {
        const ordinal = plan.length + 1;
        plan.push({ block: repetition, repetition, taskId: task.id, category: task.category, arm, position: position + 1, ordinal, runId: `${String(ordinal).padStart(3, '0')}-${task.id}-r${repetition}-${arm}` });
      });
    });
  }
  return plan;
}

export const OUTPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['finding', 'codeLocations', 'minimalFix', 'testGap', 'confidence'],
  properties: {
    finding: { type: 'string' },
    codeLocations: { type: 'array', minItems: 1, items: { type: 'string' } },
    minimalFix: { type: 'string' },
    testGap: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
});
