# Confirmation v1 invalid block

Status: invalid after seven launches. The block was not resumed or retried.

The seventh execution produced a correct causal explanation but failed one
deterministic wording regex. The answer said that the store "keys responses
only by requestId." The frozen regex accepted forms such as "keyed only by
request" but not that equivalent active-voice phrasing. The grader therefore
reported 7 of 8 facts even though the answer identified the omitted tenant,
the cross-tenant return path, both source files, the composite-key fix, and the
missing regression test.

This was a benchmark defect. It was neither a model-answer failure nor a Jev
or local-selector failure. V1 remains immutable and cannot support a campaign
claim.

## Descriptive observations before the stop

The first two tasks completed all three arms and every answer passed all frozen
facts. These results are descriptive because the prospective block did not
complete.

| Arm | Valid runs | Correct | Codex input | Codex output | Tool calls | Elapsed | Combined API-equivalent cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stock | 2 | 2 | 358,405 | 4,228 | 15 | 120.3 s | $0.5081 |
| Local | 2 | 2 | 164,603 | 2,339 | 4 | 63.1 s | $0.3190 |
| Jev | 2 | 2 | 131,319 | 2,588 | 4 | 69.6 s | $0.2156 |

Across those two tasks, Jev used 63.4% fewer Codex input tokens than stock and
20.2% fewer than local. Jev's combined cost includes 27,726 Jev input tokens at
the protocol's frozen $0.042 per million rate. The sample is too small and the
block too incomplete for confidence bounds or a confirmation claim.

## V2 correction

[Confirmation v2](CONFIRMATION-V2.md) makes three prospective corrections:

- it replaces every task observed in this invalid block;
- it tests graders against concise natural paraphrases and plausible wrong
  causes and fixes;
- it separates answer correctness from execution validity, so a correctness
  miss is recorded and the block continues while infrastructure and policy
  violations still stop immediately.
