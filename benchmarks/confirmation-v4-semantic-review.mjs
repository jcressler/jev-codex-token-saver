import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CRITERIA = Object.freeze(['cause', 'locations', 'fix', 'test']);

export const SEMANTIC_RUBRICS = Object.freeze({
  'pricing-feed-token-incident': {
    cause: 'PRC-8044 is a FeedTokenConfigurationError caused by an invalid PRICING_FEED_TOKEN during pricing-feed startup.',
    locations: 'The first two application frames are loadPricingFeedPolicy at src/pricing-policy.ts:83:11 and startPricingFeed at src/pricing-worker.ts:152:7.',
    fix: 'Set, replace, restore, or otherwise configure PRICING_FEED_TOKEN with a valid token.',
    test: 'Exercise startup with invalid and valid token configuration and assert the bounded failure/success behavior.',
  },
  'inventory-pool-incident': {
    cause: 'INV-3307 is a PoolConfigurationError caused by invalid INVENTORY_DB_POOL_SIZE configuration.',
    locations: 'The first two application frames are createInventoryPool at src/db.ts:119:13 and startInventorySync at src/sync.ts:207:5.',
    fix: 'Require INVENTORY_DB_POOL_SIZE to be a valid positive, nonzero value.',
    test: 'Exercise zero/invalid and positive pool sizes and assert startup behavior.',
  },
  'catalog-batch-incident': {
    cause: 'CAT-6721 is a BatchSizeConfigurationError caused by invalid CATALOG_INDEX_BATCH_SIZE configuration.',
    locations: 'The first two application frames are loadIndexBatchPolicy at src/index-policy.ts:58:9 and startCatalogIndexer at src/catalog-indexer.ts:131:5.',
    fix: 'Require CATALOG_INDEX_BATCH_SIZE to be a valid positive, nonzero value.',
    test: 'Exercise zero/invalid and positive batch sizes and assert indexer startup behavior.',
  },
  'webhook-byte-verification': {
    cause: 'The route parses the body and verification hashes JSON.stringify(parsedBody), so it hashes bytes that can differ from the exact provider-signed request bytes.',
    locations: 'The causal path includes src/http/body-parser.mjs and src/webhooks/verify.mjs; src/webhooks/route.mjs may also be named.',
    fix: 'Verify the HMAC over the original raw body bytes before parsing, then parse only after successful verification.',
    test: 'Cover semantically identical JSON with byte-distinct whitespace or property order and verify each exact signed byte sequence.',
  },
  'session-cache-region-scope': {
    cause: 'The session cache accepts regionId but keys get/set only by sessionId, so a colliding session ID can reuse another region\'s cached session.',
    locations: 'The causal path includes src/sessions/cache.mjs and src/sessions/load.mjs.',
    fix: 'Include both region and session ID in the cache identity, using an unambiguous composite or nested key.',
    test: 'Use the same session ID in two distinct regions and assert isolated loads and cached values.',
  },
  'permission-cache-org-scope': {
    cause: 'The permission cache accepts orgId but keys get/set only by userId, so the same user can reuse permissions from another organization.',
    locations: 'The causal path includes src/auth/permission-cache.mjs and src/auth/authorize.mjs.',
    fix: 'Include both organization and user ID in the permission-cache identity, using an unambiguous composite or nested key.',
    test: 'Use the same user in two distinct organizations and assert isolated permission loads/decisions.',
  },
  'pagination-offset-regression': {
    cause: 'offsetForPage uses page * pageSize even though public pages are one-based, so page 1 starts at 25 rather than 0 for pageSize 25.',
    locations: 'The causal expression is in src/pagination/offset.mjs and the missing regression is in tests/pagination.test.mjs.',
    fix: 'Calculate (page - 1) * pageSize, with appropriate existing input validation preserved.',
    test: 'Assert page 1 with pageSize 25 uses offset 0; a broader page sequence is also acceptable.',
  },
  'retry-max-attempts-regression': {
    cause: 'The inclusive loop condition attempt <= maxAttempts permits attempts 0, 1, 2, and 3, producing four calls when maxAttempts means three total calls.',
    locations: 'The causal boundary is in src/network/retry.mjs and the exact-count regression belongs in tests/retry.test.mjs.',
    fix: 'Use an exclusive attempt < maxAttempts loop bound and ensure the final caught error is thrown instead of falling through; an equivalent three-call implementation is acceptable.',
    test: 'With maxAttempts=3 and permanent failure, assert exactly three operation calls and rejection with the terminal error.',
  },
  'ttl-seconds-regression': {
    cause: 'ttlSeconds is passed directly to setTimeout, whose delay is milliseconds, so 60 seconds becomes about 60 milliseconds.',
    locations: 'The unit mismatch is in src/cache/expiry.mjs and the regression belongs in tests/cache-expiry.test.mjs.',
    fix: 'Convert seconds to milliseconds by multiplying ttlSeconds by 1000 before calling setTimeout.',
    test: 'Assert ttlSeconds=60 schedules a 60000 millisecond delay.',
  },
  'queue-visibility-contract': {
    cause: 'The queue visibility timeout is 30 seconds while the handler can run for 90 seconds, so a still-running job becomes visible and may be redelivered.',
    locations: 'The mismatch is established by config/export-queue.json and src/workers/export-handler.mjs or docs/export-worker.md.',
    fix: 'Set visibility timeout above maximum handler runtime plus operational margin, or renew visibility under an equivalent bounded policy.',
    test: 'Exercise a handler exceeding the old visibility window and assert no duplicate/redelivery while it is still running.',
  },
  'environment-precedence-contract': {
    cause: 'loadConfig starts with environment values and then writes defaults over them, so the packaged 60 overwrites RATE_LIMIT_PER_MINUTE=600.',
    locations: 'The precedence bug is in src/config/load.mjs and the intended contract is shown by config/defaults.json or docs/configuration.md.',
    fix: 'Apply defaults first and environment values last, or fill only missing keys, so explicit environment values win.',
    test: 'Assert an explicit environment value of 600 overrides the packaged default of 60.',
  },
  'rollout-unit-contract': {
    cause: 'checkoutPercent=25 is divided by 100 to 0.25 while seededPercent returns values from 0 through 99, so only roughly 0.25 percent pass.',
    locations: 'The scale mismatch is in src/features/rollout.mjs and the intended whole-percentage contract is in docs/feature-flags.md or config/features.json.',
    fix: 'Put threshold and random value on the same scale, such as comparing seededPercent directly with checkoutPercent without dividing by 100.',
    test: 'Use a representative deterministic population and assert approximately 25 percent are enabled, including boundary behavior.',
  },
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function reviewId(seed, runId) {
  return createHmac('sha256', seed).update(runId).digest('hex').slice(0, 16);
}

function answerOnly(answer) {
  return {
    finding: answer?.finding ?? '',
    codeLocations: Array.isArray(answer?.codeLocations) ? answer.codeLocations : [],
    minimalFix: answer?.minimalFix ?? '',
    testGap: answer?.testGap ?? '',
    confidence: answer?.confidence ?? null,
  };
}

export function prepareBlindReview(runs, seed = randomBytes(32).toString('hex')) {
  if (!Array.isArray(runs) || runs.length === 0) throw new Error('runs must be a non-empty array');
  const ids = new Set();
  const items = [];
  const labels = [];
  for (const run of runs) {
    const rubric = SEMANTIC_RUBRICS[run.taskId];
    if (!rubric) throw new Error(`missing semantic rubric for ${run.taskId}`);
    const id = reviewId(seed, run.runId);
    if (ids.has(id)) throw new Error(`duplicate review id ${id}`);
    ids.add(id);
    items.push({ id, taskId: run.taskId, rubric, answer: answerOnly(run.answer) });
    labels.push({ id, runId: run.runId, taskId: run.taskId, arm: run.arm, repetition: run.repetition });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  labels.sort((a, b) => a.id.localeCompare(b.id));
  const rubricSha256 = sha256(JSON.stringify(SEMANTIC_RUBRICS));
  return {
    packet: {
      schemaVersion: 1,
      blinded: true,
      rubricSha256,
      instructions: [
        'Judge only whether the answer is semantically correct under each supplied criterion; accept accurate paraphrases.',
        'For every criterion record true or false. pass must equal the conjunction of cause, locations, fix, and test.',
        'Do not infer missing facts from confidence, style, length, or familiarity with any benchmark arm.',
      ],
      items,
    },
    mapping: { schemaVersion: 1, seed, rubricSha256, labels },
  };
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
}

export function validateBlindJudgments(packet, review) {
  if (review?.schemaVersion !== 1 || !Array.isArray(review.judgments)) throw new Error('invalid review schema');
  const packetIds = new Set(packet.items.map(item => item.id));
  const seen = new Set();
  for (const judgment of review.judgments) {
    if (!packetIds.has(judgment.id)) throw new Error(`unknown review id ${judgment.id}`);
    if (seen.has(judgment.id)) throw new Error(`duplicate judgment ${judgment.id}`);
    seen.add(judgment.id);
    for (const criterion of CRITERIA) assertBoolean(judgment.criteria?.[criterion], `${judgment.id}.${criterion}`);
    assertBoolean(judgment.pass, `${judgment.id}.pass`);
    const expected = CRITERIA.every(criterion => judgment.criteria[criterion]);
    if (judgment.pass !== expected) throw new Error(`${judgment.id}.pass must equal all criteria`);
    if (typeof judgment.note !== 'string') throw new Error(`${judgment.id}.note must be a string`);
  }
  if (seen.size !== packetIds.size) throw new Error(`expected ${packetIds.size} judgments, received ${seen.size}`);
  return true;
}

export function reconcileBlindReviews(packet, first, second) {
  validateBlindJudgments(packet, first);
  validateBlindJudgments(packet, second);
  const byId = review => new Map(review.judgments.map(row => [row.id, row]));
  const a = byId(first);
  const b = byId(second);
  const decisions = packet.items.map(item => {
    const left = a.get(item.id);
    const right = b.get(item.id);
    const agreed = left.pass === right.pass && CRITERIA.every(key => left.criteria[key] === right.criteria[key]);
    return { id: item.id, agreed, pass: agreed ? left.pass : null, first: left, second: right };
  });
  return { schemaVersion: 1, complete: decisions.every(row => row.agreed), disagreements: decisions.filter(row => !row.agreed).map(row => row.id), decisions };
}

export function revealConsensus(consensus, mapping) {
  const labels = new Map(mapping.labels.map(row => [row.id, row]));
  return {
    schemaVersion: 1,
    complete: consensus.complete,
    disagreements: consensus.disagreements,
    results: consensus.decisions.map(decision => ({ ...labels.get(decision.id), semanticPass: decision.pass, agreed: decision.agreed })),
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command !== 'prepare') throw new Error('usage: node benchmarks/confirmation-v4-semantic-review.mjs prepare --input <summary.json> --packet <packet.json> --mapping <mapping.json> [--seed <secret>]');
  const input = option('--input');
  const packetPath = option('--packet');
  const mappingPath = option('--mapping');
  if (!input || !packetPath || !mappingPath) throw new Error('--input, --packet, and --mapping are required');
  const summary = JSON.parse(await readFile(input, 'utf8'));
  const prepared = prepareBlindReview(summary.results, option('--seed') ?? undefined);
  await writeFile(packetPath, `${JSON.stringify(prepared.packet, null, 2)}\n`);
  await writeFile(mappingPath, `${JSON.stringify(prepared.mapping, null, 2)}\n`);
  process.stdout.write(`Prepared ${prepared.packet.items.length} blinded answers. Keep ${mappingPath} from reviewers until both reviews are complete.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
