# Frozen paired pilot

This pilot evaluates whether bounded evidence selection can reduce the Codex
work needed for one real repository investigation while preserving answer
quality. It is intentionally limited to three Codex executions.

## Frozen task

The workspace is an isolated snapshot of this repository's implementation,
tests, CLI, plugin metadata, README, and skill. The task asks why failed Jev
requests underreport request-size telemetry and requests the causal path, code
locations, minimal fix, and regression test.

The defect is present in the snapshot: the Jev request is constructed before
the network call, but the outer fallback loses that request size and hardcodes
`requestChars: 0`. The public task prompt does not state that answer.

## Arms

1. `stock`: receives the task and may inspect the workspace normally.
2. `local`: receives the task plus two excerpts selected by deterministic local
   ranking; it may inspect the workspace if the packet is insufficient.
3. `jev`: receives the same task plus two excerpts selected by one live Jev
   request; it has the same workspace access as the local arm.

All Codex arms use the same pinned executable, `gpt-5.6-sol`, high reasoning,
noninteractive `never` approval policy, output schema, task text, and deterministic grader. Host
skills, memories, apps, hooks, multi-agent work, and web search are disabled.
The TypeSafe key is removed from every Codex child environment.

The Windows read-only process sandbox rejects the bundled PowerShell executable
on this host. The runner therefore uses `danger-full-access` for every arm after
a separate Luna Low smoke test verified the exact shell path and command shape.
The evaluated task is read-only and runs from a disposable fixture, but this is
process isolation rather than a security boundary.

## Measurements

The report records answer score, pass/fail, elapsed time, completed and failed
tool calls, Codex input/cached/cache-write/output/reasoning counters, full final
response characters, selector packet characters, Jev usage, and an illustrative
API-price equivalent. Subscription usage is not inferred from API pricing.

The grader awards ten points:

- two: request construction occurs before the failing Jev call;
- two: the fallback hardcodes `requestChars: 0`;
- one: emitted metrics read `ranking.requestChars`;
- two: the fix preserves actual request bytes across the failure boundary;
- two: the regression test checks nonzero or exact request size on failure;
- one: at least two relevant source/test locations are cited.

Eight points pass. The three executions are a harness and direction check, not a
statistically powered result.

## Stopping rules

The runner aborts before any Codex arm if the live Jev selector falls back, the
pinned executable does not match version `0.155.0-alpha.9.2`, its SHA-256 has
changed from the frozen manifest, or fixture hashes differ across arms. It stops
after any Codex process failure instead of retrying. The runner never launches
more than three Codex executions.

Run offline self-tests with `npm test`. A live run requires the key in
`TYPESAFE_API_KEY` and both explicit flags:

```powershell
node benchmarks/paired-pilot.mjs --live --allow-network
```
