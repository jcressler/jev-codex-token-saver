# Controlled workflow test

This is a six-execution mechanism test, not an estimate of universal savings or
natural installed-plugin adoption. It reuses the tenant-cache and webhook fixtures
from evaluation v2 but asks for executable source fixes and a regression test.
Results must not be pooled with the earlier diagnostic-only tasks.

For each task, compare stock Codex, deterministic local selection, and Jev
selection. Sol High, the pinned Codex binary, source fixture, answer contract,
available ordinary tools, and context configuration are identical. User config,
host skills, plugins, memory, and subagents are disabled for every arm. Assisted
prompts are identical and invoke the same pre-resolved evidence command exactly
once. The command invokes the actual selector during the timed Codex turn through
a local broker. Both selectors receive exactly the same candidates, with a maximum
of two returned excerpts. Jev may abstain or return fewer. No provider key enters
the Codex child process, command, or artifacts. Selector timing is included in
turn wall time; its TypeSafe tokens and API-equivalent cost are counted separately.

Run order is Jev/local/stock for tenant-cache, then stock/local/Jev for webhook.
This reverses the positions of stock and Jev, but it cannot fully balance three
positions across two tasks. Cache-hit rates are measured, not controlled; report
total input, cached input, output, all tool failures, and pricing separately.

Quality does not use the old regex grader. Source replacements and the submitted
regression are applied only in disposable validation copies after all model runs.
The existing tests must pass; the new regression must fail the original behavior
with an assertion and pass the patch; independent behavior checks must also pass.
An ordinary incorrect answer remains a scored failure, not grounds to retry or
drop that arm. Infrastructure failure stops the campaign and remains in its ledger.

Strict limit: six measured launches, two Jev requests, no automatic retries or
resume, no separate paid smoke. The first measured run acts as the canary. Each
run has a 180-second timeout and stops upon exceeding ten started tool calls.
Cumulative stop thresholds of 650,000 input and 40,000 output tokens are checked
between runs; they are not hard in-flight token ceilings. No run follows a failed
integrity check. All attempted commands, prompts, requests, responses, results,
and failures stay in the run directory. Model usage for interrupted turns may be
unavailable; do not treat missing counters as zero spending.

The manifest freezes code hashes, fixture hashes, executable hash, prompts' source,
selection policy, run order, and the same explicit price assumptions used in v2.
The 0.5 selection cutoff is a declared prototype policy, not a calibrated guarantee.
No policy, prompt, task, answer, or quality check changes after paid execution begins.

Offline preparation (fresh directory required):

```powershell
node benchmarks/controlled-workflow.mjs --prepare --run-dir benchmarks/runs/controlled-workflow-<unique-id>
```

After offline tests and independent code review pass, with TYPESAFE_API_KEY only in
the invoking process environment:

```powershell
node benchmarks/controlled-workflow.mjs --run --run-dir benchmarks/runs/controlled-workflow-<unique-id>
```

Report the result as observations on these two known fixtures. No significance or
generalization claim is justified by one execution per arm and task.
