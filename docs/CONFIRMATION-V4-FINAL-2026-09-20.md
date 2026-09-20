# Confirmation v4 final result

Status: complete. All 108 measured runs finished with no execution invalidity,
retry, substitution, or resumed partial block.

The benchmark provides strong evidence that Jev selection reduced Codex input,
elapsed time, and API-equivalent cost on this synthetic investigation suite. It
did not satisfy the protocol's zero-tolerance correctness gate: after blinded
semantic adjudication, Jev passed 33 of 36 answers and stock passed 34 of 36.

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

| Arm | Blinded semantic passes | Rate |
|---|---:|---:|
| Stock | 34/36 | 94.4% |
| Local | 32/36 | 88.9% |
| Jev | 33/36 | 91.7% |

Jev was one answer better than local and one answer worse than stock. In paired
stock-versus-Jev outcomes, 32 pairs passed both, one failed both, stock alone
passed two, and Jev alone passed one. With only three discordant pairs, a
two-sided exact McNemar test is `p = 1.0`; this benchmark does not show a
statistically detectable quality difference. It also cannot establish
noninferiority because no noninferiority margin was preregistered.

All nine semantic failures were on noisy-log configuration incidents. Each
answer found the correct cause and locations; failures came from omitting an
explicit positive/nonzero constraint or the corresponding boundary test. This
is actionable product evidence: the selected incident packet or Codex-facing
instruction should make remediation constraints and regression cases harder to
drop.

## Decision

The benchmark confirms the efficiency effect: the 95% input-saving intervals
are above zero against both stock and local selection, and combined Jev cost is
lower than both. The full preregistered confirmation flag is false because its
correctness rule allowed no regression at all and Jev finished one semantic
answer behind stock.

A defensible public claim is:

> In a 108-run synthetic Codex investigation benchmark, Jev selection reduced
> paired input tokens by 39.2% versus stock Codex (95% CI 19.4% to 56.2%) and
> 7.9% versus deterministic local selection (95% CI 4.1% to 12.0%), while
> semantic correctness was 91.7%, compared with 94.4% for stock and 88.9% for
> local selection.

The next confirmation should freeze semantic review before any measured block,
add more noisy-log tasks, and preregister a justified noninferiority margin. An
independent real-repository replication is still required before presenting
these percentages as universal Codex savings.
