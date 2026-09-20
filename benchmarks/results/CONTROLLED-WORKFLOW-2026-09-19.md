# Controlled workflow result — 2026-09-19

All six planned Sol High executions completed with passing integrity checks.
All six proposed fixes passed the executable quality checks. No run was retried,
excluded, replaced, or resumed. Two live `jev-1.13.0` requests succeeded; neither
used local fallback.

Jev used **37.2% less Codex input than deterministic local selection** in this
test. Against ordinary stock Codex, input and API-equivalent cost were nearly
equal: Jev used **0.23% more input** and cost **0.95% more**, while taking
**21.0% longer**. This test does not show an end-to-end savings advantage over
stock Codex on these two tasks.

## Totals across the two tasks

| Measure | Stock Codex | Local selection | Jev selection |
|---|---:|---:|---:|
| Functionally passing fixes | 2/2 | 2/2 | 2/2 |
| Codex input tokens | 180,100 | 287,385 | 180,523 |
| Cached input, included above | 141,056 | 255,744 | 141,056 |
| Uncached input | 39,044 | 31,641 | 39,467 |
| Codex output tokens | 7,815 | 10,193 | 7,892 |
| Tool calls | 9 | 15 | 12 |
| Nonzero tool exits | 4 | 2 | 3 |
| Total elapsed seconds | 168.399 | 234.875 | 203.800 |
| API-equivalent cost, including selector | $0.3688984 | $0.4327216 | $0.3724012 |

Relative to local selection, Jev also used 22.6% less output, made 20.0% fewer
tool calls, took 13.2% less time, and cost 13.9% less. Relative to stock, output
was 0.99% higher and tool calls were 33.3% higher. Stock and Jev happened to have
exactly the same aggregate cached input count; their near-equal cost is not
explained by one receiving a dramatically larger aggregate cache discount.

The two Jev requests used 6,448 input and 1,304 output tokens in total, costing
$0.000270816 under the frozen TypeSafe input price and free-output assumption.
Selector elapsed times were 647 ms and 694 ms, already included in the Codex
turn times above. Local selection took 8 ms on each task.

All six executions together consumed 648,008 Codex input and 25,900 output
tokens. Their combined API-equivalent cost, including both Jev requests, was
$1.174021216. These figures cover the six benchmark executions, not the
coordinating conversation or offline development. API-equivalent dollars do
not measure Codex subscription allowance.

## Each execution, in frozen order

| Run | Task | Arm | Input | Output | Tools | Seconds | Quality |
|---|---|---|---:|---:|---:|---:|---|
| 01 | Tenant cache | Jev | 77,361 | 2,812 | 7 | 68.519 | Pass |
| 02 | Tenant cache | Local | 114,239 | 4,175 | 6 | 92.811 | Pass |
| 03 | Tenant cache | Stock | 79,387 | 2,724 | 4 | 60.905 | Pass |
| 04 | Webhook signature | Stock | 100,713 | 5,091 | 5 | 107.494 | Pass |
| 05 | Webhook signature | Local | 173,146 | 6,018 | 9 | 142.064 | Pass |
| 06 | Webhook signature | Jev | 103,162 | 5,080 | 5 | 135.281 | Pass |

Nonzero exits remain counted. The audit distinguishes deliberate reproductions
of the existing bugs from exploratory command errors; a nonzero exit is not
automatically a failed benchmark execution. Commands and their complete bounded
outputs are retained in the JSON evidence, including the stock tenant arm's
search for a nonexistent `package.json`.

| Arm | Expected bug-reproduction failures | Command errors |
|---|---:|---:|
| Stock | 1 | 3 |
| Local | 1 | 1 |
| Jev | 2 | 1 |

Stock searched for a nonexistent `package.json` on both tasks. All three webhook
arms generated an inline JavaScript probe with a syntax error; Jev subsequently
ran a valid probe that reproduced the signature defect. The local/stock webhook
fixes were still independently validated after the runs. All these command costs
remain included. There were no harness failures, but the model-generated commands
were not error-free. The independent artifact audit confirmed the counters,
selector contract, matching prompts/candidates, and all six quality passes.

## What was controlled and checked

- Two fixed synthetic repositories, one execution per task and arm, same pinned
  Codex executable and `gpt-5.6-sol` with high reasoning effort.
- Same source fixture, ordinary tool access, output contract, and context
  configuration for every arm. Local/Jev prompts and candidate files are
  byte-identical within each task.
- Same ready-to-use evidence command for both assisted arms; selection actually
  occurs inside the measured turn. No skill-path discovery, precalculated
  evidence injection, or key exposure to the Codex child process.
- Maximum two selected excerpts, with Jev allowed to return fewer based on its
  predeclared eligibility policy. Both selectors receive the same candidates.
- Code, fixture, executable, schema, wrapper, and preflight hashes frozen before
  launch. No evaluator or policy changes after results began arriving.
- Returned source replacements are tested in disposable copies. Existing tests
  must pass; submitted regression tests must fail the original behavior and
  pass the replacement; independent checks verify tenant isolation, cache reuse,
  product separation, exact-byte webhook verification, and tamper rejection.
- The old keyword-based graders do not participate in quality decisions. The
  functional validator receives task ID and answer, not the arm or usage.
- All original fixture copies remained unchanged during Codex execution. No
  timeout, budget stop, missing usage, duplicate selector request, authentication
  failure, or fallback occurred.

The repaired selector chose `src/cache.mjs` for the tenant task; local chose
`docs/cache-policy.md` and `src/catalog.mjs`. For webhook diagnosis, Jev chose
`src/signature.mjs` and `src/route.mjs`; local chose `docs/provider.md` and
`docs/json-normalization.md`. This shows that Jev selected the causal source
files in both cases, even though total task usage did not beat stock overall.

## Scope and reproducibility

These are two small, previously used fixtures, now framed as executable fixes
rather than diagnostic-only answers. This is not a held-out generalization
study, natural installed-skill adoption test, or native compaction test. With
one execution per arm and task, it cannot estimate a stable average effect or
separate all model execution variance. The two task orders reverse stock/Jev
positions; they do not fully balance three positions. Cache state is observed,
not experimentally fixed. No broad token-savings percentage is claimed.

The frozen [protocol](../CONTROLLED-WORKFLOW.md) and
[machine-readable evidence](CONTROLLED-WORKFLOW-2026-09-19.json) include the full
per-run answers, quality checks, commands, candidate/evidence packets, Jev
requests/responses, price assumptions, hashes, and comparisons. User home paths
are replaced with `<USER_HOME>` in the public evidence; credentials are absent.
Original raw artifacts remain in the ignored run directory
`benchmarks/runs/controlled-workflow-20260919-2033`.

Manifest SHA-256:
`f30764fa3570cefb2976b2a92c3a03048a2a5a3d01c06bfe0f7630e263cbaf7c`.

Offline preparation passed all 41 tests and syntax checks via `npm run check`.
