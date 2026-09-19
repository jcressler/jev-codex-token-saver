# Evaluation v2 — frozen preflight protocol

This campaign compares stock Codex, deterministic local evidence selection, and
Jev evidence selection without repeating the first pilot's attribution and
accounting mistakes. The historical paired pilot remains unchanged.

## Frozen design

- Model: `gpt-5.6-sol`, reasoning effort `high` for every Codex execution.
- Tasks: two new, isolated repository investigations whose answers are absent
  from the evaluated fixtures.
- Arms: stock, local, and Jev.
- Repetitions: two per task and arm, for exactly 12 measured executions.
- Order: deterministic, seed-derived blocks with Latin-square arm rotation. Each
  arm occurs in every position as evenly as four blocks allow.
- Selectors: local and Jev receive the exact same bounded candidate packet and
  return the same number of excerpts. Selector outputs are frozen once per task
  and reused for both repetitions.
- Grading: task-specific factual rubrics are frozen in
  `evaluation-v2.manifest.json`. The grader never receives the arm label.
- Quality remains the first gate. Identical local/Jev packets remain in the
  overall results and must also be reported separately as execution-variance
  controls.

## Hard execution gates

The runner verifies the Codex executable version and SHA-256, every fixture file
hash, the 12-run plan, the model, and the effort before doing anything live.
Offline tests cover successful and malformed event streams, tool failure,
process timeout, TypeSafe authentication failure, malformed Jev answers,
request-size accounting, durable state, budget enforcement, and retry refusal.

Every live campaign uses a unique ignored `benchmarks/runs/<id>` directory. It
records state before each launch, then stores the exact prompt, packet, config,
fixture hashes, raw stdout JSONL, raw stderr, parsed answer, score, usage, and
status. Each Codex execution gets a fresh fixture. A changed fixture, missing
usage, timeout, nonzero exit, malformed answer, or configuration discrepancy
stops the campaign. There are no automatic retries or automatic resumes.

The Codex child never receives `TYPESAFE_API_KEY`. Selector request and response
artifacts omit credentials. Runtime artifacts are ignored by Git because they
may contain source excerpts.

## Spending boundary

The campaign permits one separately recorded smoke execution followed by at
most 12 measured executions. Its cumulative stop thresholds are 1,800,000 Codex
input tokens, 80,000 Codex output tokens, 100 tool calls, two Jev requests, and
100,000 Jev input tokens. Token totals are checked between executions, so a
final execution can cross a token threshold; the execution-count limits are
strict.

At the frozen public prices, those token ceilings equal at most $8.80 in
OpenAI API-equivalent token cost if all Codex input were uncached, plus $0.0042
for Jev input. This is a cost reference, not a prediction of Codex subscription
or weekly-limit consumption. Jev currently lists input at $0.042 per million
tokens and output as free; Sol lists $4 per million input, $0.40 cached input,
and $20 per million output.

## Staged commands

The first command is completely offline apart from the local `codex --version`
check and cannot launch a model:

```powershell
npm test
npm run check
npm run eval:v2:prepare
```

After reviewing that output, create one durable run directory and perform only
the smoke test:

```powershell
$jevEvalRun = 'benchmarks/runs/evaluation-v2-YYYYMMDD-HHMMSS'
node benchmarks/evaluation-v2.mjs --smoke --accept-budget --run-dir $jevEvalRun
```

Inspect `$jevEvalRun/state.json`. Only a completed, passing smoke state unlocks
the campaign. The measured campaign is a separate command:

```powershell
node benchmarks/evaluation-v2.mjs --run --allow-network --accept-budget --run-dir $jevEvalRun
```

If a command fails or is interrupted, preserve that run directory. The runner
will refuse to repeat ambiguous or failed paid work. Diagnose it and prepare a
new protocol revision rather than editing the evidence after seeing outcomes.

Pricing sources: [OpenAI GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
and [TypeSafe Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
