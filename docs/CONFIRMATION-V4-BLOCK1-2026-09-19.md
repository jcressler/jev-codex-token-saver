# Confirmation v4 block 1 result

Status: all 36 planned executions completed. This is a complete first block,
not the full three-block confirmation campaign.

The block used 12 fresh deterministic tasks, one execution per task and arm,
Sol High, Codex CLI 0.155.1, plugin 0.3.1, and live `jev-1.13.0`. There were no
retries, substitutions, timeouts, policy violations, fixture changes, missing
usage records, or selector fallbacks in the Jev arm. The Jev arm made exactly
12 measured requests. The complete machine-readable result is
[`CONFIRMATION-V4-BLOCK1-2026-09-19.json`](../benchmarks/results/CONFIRMATION-V4-BLOCK1-2026-09-19.json).

## Performance

| Arm | Runs | Codex input | Median input | Codex output | Tools | Elapsed | Codex API-equivalent | Jev cost | Combined |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Stock | 12 | 1,543,434 | 88,532 | 22,926 | 59 | 618.4 s | $2.1137 | $0 | $2.1137 |
| Local | 12 | 794,761 | 60,071 | 15,470 | 24 | 411.8 s | $1.2844 | $0 | $1.2844 |
| Jev | 12 | 704,806 | 57,499 | 15,916 | 24 | 418.2 s | $1.1515 | $0.0046 | $1.1561 |

Relative to stock, Jev used 54.3% fewer total Codex input tokens, 35.1% fewer
median input tokens, 30.6% fewer output tokens, 59.3% fewer tools, 32.4% less
elapsed time, and 45.3% lower combined API-equivalent cost.

Relative to deterministic local selection, Jev used 11.3% fewer total Codex
input tokens, 4.3% fewer median input tokens, and 10.0% lower combined cost.
Jev used the same number of tools, 2.9% more output tokens, and 1.6% more elapsed
time than local. Jev's own charge was 0.4% of its combined cost.

Jev used fewer input tokens than stock on 11 of 12 tasks and fewer than local
on all 12. The task-paired geometric-mean input reduction was 44.7% versus
stock, with a task-bootstrap 95% interval of 25.1% to 60.9%. It was 10.9%
versus local, with a 95% interval of 4.9% to 18.3%.

These intervals describe this completed block. The frozen confirmation rule
still requires all three repetitions, so `campaignComplete`, `confirmedSavings`,
and `confirmedAtLeast20Percent` remain false.

## Correctness audit

The frozen regex grader reported stock 8 of 12, local 6 of 12, and Jev 7 of 12.
Those counts are preserved in the raw result and make the prospective
`correctnessNoRegression` field false.

An arm-neutral semantic audit of every one of the 15 automatic failures found
that all 15 answers were substantively correct. The failures came from seven
rubric defects:

- `orgId` did not match a pattern that required the word `organization`;
- executable syntax such as `offsetForPage(1, 25) === 0` did not match the
  phrase `page 1 ... offset 0`;
- `redelivery`, `delivered twice`, and `second time` did not match a narrow
  `redeliver|duplicate` expression;
- a correct prose description of a session-only cache key did not match the
  expected literal code expression;
- the retry oracle expected changing the loop to `<`, while the answers
  correctly identified that changing the terminal test from `>` to `>=` avoids
  a fourth call without allowing the function to fall through and resolve;
- a correct same-scale rollout fix did not use one of the expected phrases;
- `src/db.ts:createInventoryPool:119:13` did not match the exact formatting
  `src/db.ts:119:13` even though the symbol and location were both present.

The 21 automatic passes already satisfied every frozen fact. The supplemental
semantic result is therefore 12 of 12 correct for each arm. Because this review
was conducted after the block, it is secondary evidence and does not overwrite
the prospective fields.

## Interpretation

This block is strong evidence that the Jev selector can reduce Codex input and
combined cost on these bounded investigation tasks while preserving answer
quality. It also shows a smaller but consistent input and cost advantage over
the local selector. It is not yet a universal product claim: the tasks are
synthetic, only one repetition is complete, and the deterministic correctness
grader needs an independently frozen semantic adjudication procedure before
the remaining blocks can support a final confirmation claim.
