# Installed workflow pilot

This gate measures the plugin as Codex actually uses it. Unlike evaluation v2,
the Jev evidence packet is not precomputed and inserted into the prompt. The Jev
arm explicitly invokes the installed `$jev-codex-token-saver` skill, and Codex's
reported usage therefore includes skill discovery, skill instructions, selector
invocation, evidence handling, verification, and the final answer.

The first pair uses one real read-only question about this repository's CLI:
what happens when `--diagnostics` names an existing file. Both arms use the same
frozen Codex executable, Sol High, answer schema, workspace snapshot, task, and
per-run limits. The stock arm uses ordinary Codex search. The Jev arm makes one
authorized selector call and must produce a diagnostic report whose mode is
exactly `jev`; `local-fallback` fails the gate and is never counted as a Jev run.

Run one arm at a time. `--task` accepts `existing-diagnostics-file` or the
broader `campaign-resume-budget-gates` harness audit:

```powershell
$bin = 'C:\path\to\the\pinned\codex.exe'
$run = 'benchmarks/runs/installed-workflow-pilot-YYYYMMDD-HHMM'
node benchmarks/installed-workflow-pilot.mjs --task existing-diagnostics-file --arm stock --run-dir $run --codex-bin $bin

$env:TYPESAFE_API_KEY = '<set outside shell history>'
node benchmarks/installed-workflow-pilot.mjs --task existing-diagnostics-file --arm jev --run-dir $run --codex-bin $bin
Remove-Item Env:TYPESAFE_API_KEY
```

Each arm is single-launch. Existing results cannot be overwritten or retried.
The harness checks the pinned Codex version and SHA-256 before a model call,
hashes the fixture before and after, requires the quality rubric to pass, and
caps each execution at 150,000 input tokens, 8,000 output tokens, and 15 tool
calls. The Jev arm also requires a verified skill command and a successful Jev
diagnostic. A failed authentication remains a failed gate; its answer and Codex
usage must not be presented as Jev performance.

After both arms exist, the harness writes `blind-review.json` with answer IDs but
no arm, run, usage, or timing labels. It writes the separate `label-map.json` for
joining only after review. Independent review is still required for a truly
blinded semantic judgment.

Only after the first pair passes should another task be added and run. Review
answers from the label-free packet produced by `anonymizeAnswers` before joining
them to arm labels.

The first completed pair is published in
[`results/INSTALLED-WORKFLOW-PILOT-2026-09-19.md`](results/INSTALLED-WORKFLOW-PILOT-2026-09-19.md).
The broader follow-up stopped after its stock arm exceeded the fixed per-run
input gate, so no Jev counterpart was launched and no comparison is reported.
