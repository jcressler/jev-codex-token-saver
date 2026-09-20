# Confirmation v2 invalid block

Status: invalid after one launch. The block was not resumed or retried.

The first stock execution made 11 bounded read-only shell calls. V2's frozen
runaway monitor allowed only 10 and terminated the process before it emitted
final usage telemetry or a completed answer. Weekly usage remained at 86% used
before and after the attempt.

This was a benchmark configuration defect. Ten calls had been chosen from the
7- and 8-call stock observations in the invalid v1 block, but a safety cutoff
must leave room for ordinary stock-search variance. No V2 performance result is
usable.

[Confirmation v3](CONFIRMATION-V3.md) replaces the exposed task, permits up to
30 stock tool calls, adds an exact unit test that accepts call 30 and rejects
call 31, and retains the block-wide token and tool budgets. Local and Jev arms
remain constrained to exactly two gateway calls.
