# Gateway pilot on 2026-09-19

## Result: invalid, not proof

This six-run Sol High pilot cannot establish the preregistered claim. Five runs
completed and one stock run timed out, but two protocol defects invalidate the
comparison:

1. The task requirements accidentally named oracle facts such as the exception,
   configuration key, stack frames, and cache-key mismatch. A correct final
   answer therefore did not prove that the arm retrieved those facts.
2. The stock arm used Codex's Windows `read-only` sandbox with
   `approval_policy=never`. Codex's attempted `rg` and directory-listing commands
   were blocked by policy. The first stock answer reproduced facts from the
   prompt without successfully reading the fixture. The second stock run timed
   out after 300,184 ms and logged 2,366 failed `apply_patch` attempts.

There were no retries. The missing stock usage was not imputed, so the planned
two-task median comparison and the 20% success criterion are not evaluable.

## Recorded observations

| Task | Arm | Codex input | Cached input | Output | Time | Status |
|---|---:|---:|---:|---:|---:|---|
| Checkout log | Stock | 109,323 | 90,752 | 1,868 | 56.8 s | Completed, but answer leaked by prompt |
| Checkout log | Local | 74,633 | 49,920 | 735 | 22.0 s | Completed, but answer leaked by prompt |
| Checkout log | Jev | 57,053 | 54,016 | 760 | 24.8 s | Completed, but answer leaked by prompt |
| Tenant cache | Local | 58,484 | 41,984 | 707 | 24.2 s | Completed, but answer leaked by prompt |
| Tenant cache | Jev | 58,488 | 41,984 | 819 | 26.2 s | Completed, but answer leaked by prompt |
| Tenant cache | Stock | unavailable | unavailable | unavailable | 300.2 s | Timed out; no `turn.completed` event |

These figures remain useful for debugging, but they are descriptive only. Across
the two local/Jev pairs, Jev used 13.2% fewer Codex input tokens, 9.5% more Codex
output tokens, and 10.4% more elapsed time. At the prices recorded below, the
API-equivalent total was 35.3% lower for Jev, largely because the checkout Jev
run had a much larger cached-input share. Run order and cache behavior are still
potential confounders.

Jev itself behaved as intended on both calls. `jev-1.13.0` made exactly one
selection request per task, used 22,301 input and 2,808 output tokens total, and
added 1,315 ms total selector latency. Its direct cost was $0.000936642 at
$0.042 per million input tokens with unmetered output. On the log task it reduced
the estimated evidence packet from 14,378 to 267 tokens; on the cache task it
reduced 2,705 to 306 tokens. Those are packet reductions, not proven end-to-end
Codex savings.

The API-equivalent Codex calculations use GPT-5.6 Sol prices of $4.00 per million
uncached input tokens, $0.40 per million cached input tokens, and $20.00 per
million output tokens. Codex subscription usage is not the same as an API bill.

## Corrections now enforced

The next prepared campaign:

- describes required fact categories without disclosing oracle values;
- uses a functioning Codex shell configuration for stock while retaining fixture
  before/after hashes and explicit no-write instructions;
- treats any Codex tool-router error as an immediate invalid run;
- monitors Jev calls live and stops extra selection calls, shell use in gateway
  arms, web search, and unexpected MCP calls;
- hashes the runner, MCP bundle, fixtures, and exact Codex binary before launch;
- writes a partial summary when any run is invalid and never retries it.

Raw run artifacts stay under the ignored `benchmarks/runs/` directory. The
machine-readable public record is
`benchmarks/results/gateway-pilot-2026-09-19.json`.
