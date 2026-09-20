# Confirmation v4 final result

Status: complete. All 108 measured runs finished with no execution invalidity,
retry, substitution, or resumed partial block.

The benchmark provides strong evidence that Jev selection reduced Codex input,
elapsed time, and API-equivalent cost on this synthetic investigation suite. It
also found no substantive answer-quality regression after correcting an
unsupported requirement in the secondary semantic rubric. The original rubric
recorded Jev at 33/36, stock at 34/36, and local at 32/36; an evidence-grounded
audit of every failure yields 36/36 for all three arms. The raw rubric outcomes
remain preserved in the machine-readable audit trail.

See the [quality audit](CONFIRMATION-V4-QUALITY-AUDIT-2026-09-20.md) for the
affected answers, source evidence, and limits of the retrospective correction.

The complete machine-readable audit trail is in
[`benchmarks/results/confirmation-v4-2026-09-20`](../benchmarks/results/confirmation-v4-2026-09-20/).
It includes the manifest, rehearsal, all 108 answers and measurements, blinded
packet, hidden mapping, two independent reviews, tie-break review, consensus,
and SHA-256 hashes.

## Execution integrity

- Frozen benchmark commit: `c593e3dcc9fb0ff2c84bd4b5e7c3c0b963b5e8bb`
- Model: `gpt-5.6-sol`, reasoning effort `high`
- Codex: `codex-cli 0.155.1`, pinned executable hash
- Jev: `jev-1.13.0`, one measured request per Jev run
- Design: 12 tasks x 3 repetitions x 3 arms = 108 runs
- Valid runs: 108 of 108
- Measured Jev requests: 36 of 36
- Retries or substituted runs: 0

| Block | Runs | Input tokens | Output tokens | Tool calls | Jev requests |
|---|---:|---:|---:|---:|---:|
| 1 | 36 | 3,043,001 | 54,312 | 107 | 12 |
| 2 | 36 | 2,980,619 | 55,552 | 115 | 12 |
| 3 | 36 | 3,128,934 | 52,592 | 107 | 12 |
| **Total** | **108** | **9,152,554** | **162,456** | **329** | **36** |

Every block remained below its frozen input, output, tool, and Jev-request
limits. The live credential smoke passed before each block.

Two non-measured setup stops are retained here for completeness. Before Block
2, the first detached-worktree command stopped at the frozen runner hash check
because the Windows checkout had different line-ending bytes. Block 2 still had
zero launches and zero credential-smoke attempts. The exact committed blobs
were restored byte for byte, the worktree index was clean, and only then did the
successful block command begin. No measured execution was retried.

## Efficiency results

| Arm | Valid runs | Median input/run | Total input | Output | Tools | Elapsed | Combined API-equivalent cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stock Codex | 36 | 85,869 | 4,643,824 | 68,072 | 185 | 1,897.7 s | $6.2003 |
| Local selection | 36 | 59,887.5 | 2,384,333 | 48,534 | 72 | 1,351.7 s | $3.7485 |
| Jev selection | 36 | 57,654 | 2,124,397 | 45,850 | 72 | 1,292.5 s | $3.4205 |

Relative to stock, Jev used 54.25% fewer total Codex input tokens, 32.64%
fewer output tokens, 61.08% fewer tool calls, 31.89% less elapsed time, and
44.83% lower combined API-equivalent cost.

Relative to deterministic local selection, Jev used 10.90% fewer total Codex
input tokens, 5.53% fewer output tokens, the same number of tools, 4.38% less
elapsed time, and 8.75% lower combined cost.

The frozen primary analysis uses each task's median across three repetitions,
then the geometric mean of the twelve paired ratios:

| Comparison | Estimated input reduction | Deterministic bootstrap 95% CI |
|---|---:|---:|
| Jev vs stock | 39.23% | 19.37% to 56.20% |
| Jev vs local | 7.89% | 4.05% to 12.04% |

Both confidence intervals exclude zero. The stronger preregistered claim that
the lower bound exceeds 20% narrowly fails because the stock lower bound is
19.37%.

Jev itself processed 329,949 input tokens and 50,544 output tokens. Under the
frozen price assumptions, that added $0.0139; the total Jev arm cost above
already includes it. These are API-equivalent estimates, not a claim about a
subscriber's actual Codex plan charge.

## Correctness

The frozen literal graders remain part of the primary record. Their strict
regexes rejected several substantively correct paraphrases:

| Arm | Frozen automatic passes | Rate |
|---|---:|---:|
| Stock | 24/36 | 66.7% |
| Local | 23/36 | 63.9% |
| Jev | 22/36 | 61.1% |

After Block 1 and before Blocks 2 and 3, commit `68b2aae` froze a secondary
semantic procedure with task-specific rubrics. Two independent reviewers saw
only a shuffled arm-blind packet. They agreed on 107 of 108 answers. A third
arm-blind reviewer resolved the one disagreement. Labels were joined only after
the review files validated.

The first Reviewer A transport attempt was also discarded before adjudication:
the read-only command policy prevented it from opening the packet, it never saw
an answer, and it produced no review file. The valid Reviewer A and B runs
received the frozen packet directly as inline input. Their files passed exact
ID, count, boolean-consistency, and conjunction validation before unblinding.

| Arm | Original blinded rubric passes | Rate |
|---|---:|---:|
| Stock | 34/36 | 94.4% |
| Local | 32/36 | 88.9% |
| Jev | 33/36 | 91.7% |

Those numbers accurately reproduce the rubric decisions, but the rubric was
over-specified. All nine failures were on noisy-log configuration incidents.
Each answer found the correct cause and locations and proposed a valid bounded
correction and regression check. The fixtures said only that the setting was
invalid; they provided no validator, accepted range, rejected literal, or zero
semantics. The original task definition explicitly accepted a valid supported
setting and requested only a regression check. The later semantic rubric added
mandatory positive/nonzero wording and an explicit zero-invalid versus
positive-success test.

Removing only those unsupported penalties, while retaining every other review
judgment, produces the evidence-grounded retrospective result:

| Arm | Corrected semantic passes | Rate |
|---|---:|---:|
| Stock | 36/36 | 100% |
| Local | 36/36 | 100% |
| Jev | 36/36 | 100% |

The original stock-versus-Jev rubric comparison contained two stock-only passes
and one Jev-only pass, rather than one isolated Jev error. Its two-sided exact
McNemar result was `p = 1.0`. More importantly, direct inspection shows that all
three Jev answers contained the task-supported remediation and test evidence;
the supposedly omitted constraint did not exist in the full source material.
This audit therefore finds no substantive quality loss attributable to Jev in
these runs.

## Decision

The benchmark confirms the efficiency effect: the 95% input-saving intervals
are above zero against both stock and local selection, and combined Jev cost is
lower than both. Under the corrected evidence-grounded quality assessment, Jev
also has no observed answer-quality regression: all arms are 36/36. Because the
rubric correction is retrospective and the semantic procedure was frozen only
after Block 1, this is not presented as a newly preregistered quality result.
It is the corrected interpretation of the completed benchmark evidence.

A defensible public claim is:

> In a 108-run synthetic Codex investigation benchmark, Jev selection reduced
> paired input tokens by 39.2% versus stock Codex (95% CI 19.4% to 56.2%) and
> 7.9% versus deterministic local selection (95% CI 4.1% to 12.0%). A
> source-grounded audit corrected an over-specified secondary rubric and found
> 36/36 substantively correct answers for Jev, stock, and local selection.

The next confirmation should freeze the evidence-grounded semantic rubric
before any measured block and preregister a justified noninferiority margin. An
independent real-repository replication is still required before presenting
these percentages or equal observed correctness as universal Codex behavior.
