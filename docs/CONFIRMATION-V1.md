# Confirmation evaluation v1

Status: prospective protocol implemented; no measured run has launched.

This evaluation is the confirmation step after the corrected six-run gateway
pilot. It is deliberately block-gated so one command cannot accidentally spend
the full campaign budget.

## Design

The suite contains twelve new deterministic tasks:

- three noisy-log incident investigations;
- three large-repository issue-localization investigations;
- three failing-test root-cause investigations;
- three mixed code, configuration, and documentation investigations.

Every task compares stock Codex, deterministic local gateway selection, and
live Jev selection. Each task-arm pair runs three times, for 108 measured runs.
The task order is seed-derived and the arm order rotates so every arm occupies
every within-task position once.

The fixtures are synthetic and purpose-built. They give exact reproducible
oracles and let the harness verify that every bounded candidate packet contains
the necessary evidence. They are useful confirmation evidence, but a later
independent real-workload replication remains necessary for a broad product
claim.

## Frozen execution rules

- Model: `gpt-5.6-sol`, reasoning effort `high`.
- Codex version: `codex-cli 0.155.1`, verified by executable hash.
- Jev model: `jev-1.13.0`.
- The committed runner, task definitions, MCP bundle, Git revision, Codex
  executable, generated fixtures, prompt, and output schema are hashed.
- Every Codex execution is ephemeral and receives a fresh task invocation.
- Stock may use normal efficient shell search and bounded reads.
- Local and Jev receive identical tool arguments and candidate/result caps.
- Local runs have no Jev key. Jev runs make one real selection request.
- Selector outputs are not reused between repetitions.
- Web search, edits, retries, automatic continuation, and arm-aware grading are
  prohibited.
- A timeout, router failure, missing usage, malformed output, fixture mutation,
  policy violation, or failed frozen grader stops the block.

Recorded stock command misses remain visible but do not invalidate an otherwise
correct run. This policy was frozen before launch because normal search tools
can return exit code 1 for no matches and then recover with a narrower query.

## Blocks and budgets

The campaign has three blocks of 36 runs. A block can launch only after the
offline rehearsal passes, and blocks two and three require the previous block
to have completed. A started, failed, or interrupted block cannot be resumed or
retried.

Each block stops before the next launch after any threshold is exceeded:

- 4,500,000 Codex input tokens;
- 100,000 Codex output tokens;
- 300 Codex tool calls;
- 12 Jev requests.

## Frozen decision rule

The task is the statistical unit. For each task and arm, the three repetitions
produce a median input-token count. The primary effect is the geometric mean of
the twelve paired Jev-to-stock ratios. A deterministic 10,000-draw task-level
paired bootstrap produces the 95% confidence interval.

The campaign confirms a savings benefit only when all 108 runs complete and:

1. the lower 95% bound for input-token reduction versus stock is above zero;
2. Jev has no correctness regression;
3. combined Codex-plus-Jev API-equivalent cost is below both stock and local.

The stronger “at least 20%” result requires the lower 95% bound itself to exceed
20%, rather than merely requiring the point estimate to exceed 20%.

## Staged commands

Preparation requires a clean committed repository and the exact Codex binary:

```powershell
$confirmationRun = 'benchmarks/runs/confirmation-v1-YYYYMMDD-HHMMSS'
$codexBenchmarkBinary = 'C:\path\to\codex-0.155.1.exe'
node benchmarks/confirmation-v1.mjs --prepare --run-dir $confirmationRun --codex-binary $codexBenchmarkBinary
node benchmarks/confirmation-v1.mjs --rehearse --run-dir $confirmationRun
```

The rehearsal makes no Codex or live Jev request. It validates all hashes,
checks prompts for oracle leakage, proves every packet is Jev-eligible, and uses
a deterministic semantic mock to confirm that the typed Jev contract can
recover the frozen evidence.

Each measured block is a separate explicit command:

```powershell
node benchmarks/confirmation-v1.mjs --run-block --block 1 --run-dir $confirmationRun
node benchmarks/confirmation-v1.mjs --run-block --block 2 --run-dir $confirmationRun
node benchmarks/confirmation-v1.mjs --run-block --block 3 --run-dir $confirmationRun
```

Inspect `summary.json` and the durable state after each block. Do not edit the
protocol after the first measured launch.
