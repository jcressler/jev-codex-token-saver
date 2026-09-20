# Corrected gateway pilot on 2026-09-19

## Outcome

The corrected six-run Sol High pilot passed its preregistered gate: median Codex
input was 57,836.5 tokens with Jev and 90,467 tokens with stock Codex, a 36.07%
reduction, with no correctness regression. All six answers passed every frozen
fact check, all fixtures remained unchanged, and no run was repeated.

This is promising evidence for the gateway design. It is a two-task pilot with
one run per arm, so it does not establish a universal savings rate.

## Per-run measurements

| Task | Arm | Input | Cached input | Output | Tools | Time | Correct |
|---|---:|---:|---:|---:|---:|---:|---:|
| Checkout log | Stock | 109,618 | 85,504 | 1,044 | 5 | 49.1 s | 100% |
| Checkout log | Local | 87,303 | 59,520 | 703 | 2 | 23.6 s | 100% |
| Checkout log | Jev | 57,894 | 48,896 | 679 | 2 | 21.6 s | 100% |
| Tenant cache | Local | 58,398 | 49,152 | 911 | 2 | 27.8 s | 100% |
| Tenant cache | Jev | 57,779 | 51,968 | 1,062 | 2 | 28.4 s | 100% |
| Tenant cache | Stock | 71,316 | 51,072 | 1,352 | 3 | 36.4 s | 100% |

Across both tasks, Jev versus stock used 36.07% fewer Codex input tokens, 27.34%
fewer output tokens, 50% fewer tool calls, and 41.51% less wall time. Jev versus
local fallback used 20.61% fewer Codex input tokens and 2.70% less wall time,
with 7.87% more output tokens and the same number of tool calls.

## Cost

At the prices in effect on the run date, the API-equivalent totals were:

| Arm | Codex cost | Jev cost | Combined |
|---|---:|---:|---:|
| Stock | $0.279982 | $0 | $0.279982 |
| Local | $0.223865 | $0 | $0.223865 |
| Jev | $0.134402 | $0.000980 | $0.135381 |

That is a 51.65% reduction versus stock and a 39.53% reduction versus local in
this pilot. The calculation uses GPT-5.6 Sol rates of $4.00 per million uncached
input tokens, $0.40 per million cached input tokens, and $20.00 per million
output tokens, plus Jev at $0.042 per million input tokens with unmetered output.
Codex subscription usage is not the same as an API bill.

## Jev behavior

`jev-1.13.0` made exactly one selection request per Jev run. Across both tasks it
used 23,323 input and 2,808 output tokens, added 1,345 ms selector latency, and
cost $0.000979566. It reduced the log evidence packet from an estimated 13,921
to 267 tokens and the cache packet from 4,691 to 306 tokens before Codex saw it.

The log task shows the strongest benefit: Jev selected one causal block while
local fallback returned four blocks. On the smaller cache task, both methods
already returned compact evidence, so Jev's end-to-end input advantage over
local was only about 1.1% for that task.

## Transparent adjudication

Two validator defects stopped the harness, and both corrections are recorded in
durable state. Neither model run was repeated or replaced:

1. The first stock run had one broad `rg` command return exit code 1 before
   Codex recovered with bounded reads and produced a fully correct cited answer.
   The published protocol records failures but did not define a recoverable stock
   search miss as an invalidator, so the policy validator was corrected.
2. The local cache answer used the exact JavaScript template literal
   `${tenantId}:${productId}`. The original regex did not allow the braces and
   produced a false negative. The unchanged answer passed the corrected
   equivalent-expression check.

These post-run validator corrections weaken the strength of preregistration,
even though they did not change prompts, outputs, tokens, timing, or correctness
facts. A larger evaluation should freeze these corrected validators and add
repetitions before making a general percentage claim.

The machine-readable result is
`benchmarks/results/gateway-pilot-corrected-2026-09-19.json`.
