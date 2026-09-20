import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBlindReview, reconcileBlindReviews, revealConsensus, SEMANTIC_RUBRICS, validateBlindJudgments } from './confirmation-v4-semantic-review.mjs';
import { TASKS } from './confirmation-v4-tasks.mjs';

const runs = [
  { runId: '001-a-r1-stock', taskId: 'pagination-offset-regression', arm: 'stock', repetition: 1, usage: { input_tokens: 99 }, answer: { finding: 'One based page 1 is multiplied by 25.', codeLocations: ['src/pagination/offset.mjs'], minimalFix: '(page - 1) * pageSize', testGap: 'page 1 must be offset 0', confidence: 1 } },
  { runId: '002-b-r1-jev', taskId: 'ttl-seconds-regression', arm: 'jev', repetition: 1, selector: { secret: true }, answer: { finding: 'Seconds are sent to a millisecond timer.', codeLocations: ['src/cache/expiry.mjs'], minimalFix: 'multiply by 1000', testGap: '60 maps to 60000', confidence: 1 } },
];

function passingReview(packet, reviewer = 'reviewer-a') {
  return {
    schemaVersion: 1,
    reviewer,
    judgments: packet.items.map(item => ({ id: item.id, criteria: { cause: true, locations: true, fix: true, test: true }, pass: true, note: 'All reference facts are present.' })),
  };
}

test('every frozen task has exactly one semantic rubric', () => {
  assert.deepEqual(Object.keys(SEMANTIC_RUBRICS).sort(), TASKS.map(task => task.id).sort());
  for (const rubric of Object.values(SEMANTIC_RUBRICS)) assert.deepEqual(Object.keys(rubric), ['cause', 'locations', 'fix', 'test']);
});

test('blind packet excludes arm, run, usage, and selector metadata', () => {
  const { packet, mapping } = prepareBlindReview(runs, 'fixed-secret-seed');
  const text = JSON.stringify(packet);
  for (const forbidden of ['001-a-r1-stock', '002-b-r1-jev', 'input_tokens', 'selector', '"arm"', '"runId"', '"repetition"']) assert.equal(text.includes(forbidden), false, forbidden);
  assert.equal(packet.items.length, 2);
  assert.equal(mapping.labels.length, 2);
  assert.notEqual(packet.items[0].id, runs[0].runId);
});

test('judgment validation requires complete boolean criteria and matching pass', () => {
  const { packet } = prepareBlindReview(runs, 'fixed-secret-seed');
  const valid = passingReview(packet);
  assert.equal(validateBlindJudgments(packet, valid), true);
  const invalid = structuredClone(valid);
  invalid.judgments[0].criteria.test = false;
  assert.throws(() => validateBlindJudgments(packet, invalid), /pass must equal all criteria/);
});

test('two agreeing blind reviews reveal labels only after reconciliation', () => {
  const { packet, mapping } = prepareBlindReview(runs, 'fixed-secret-seed');
  const consensus = reconcileBlindReviews(packet, passingReview(packet, 'a'), passingReview(packet, 'b'));
  assert.equal(consensus.complete, true);
  assert.deepEqual(consensus.disagreements, []);
  const revealed = revealConsensus(consensus, mapping);
  assert.equal(revealed.results.length, 2);
  assert.deepEqual(new Set(revealed.results.map(row => row.arm)), new Set(['stock', 'jev']));
});

test('review disagreement remains unresolved and cannot silently pass', () => {
  const { packet } = prepareBlindReview(runs, 'fixed-secret-seed');
  const first = passingReview(packet, 'a');
  const second = passingReview(packet, 'b');
  second.judgments[0].criteria.test = false;
  second.judgments[0].pass = false;
  const consensus = reconcileBlindReviews(packet, first, second);
  assert.equal(consensus.complete, false);
  assert.equal(consensus.decisions.find(row => row.id === second.judgments[0].id).pass, null);
});
