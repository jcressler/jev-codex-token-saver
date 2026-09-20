# Frozen next controlled evaluation

Status: corrected pilot completed and passed; full repeated evaluation not
launched. See the [invalid pilot audit](GATEWAY-PILOT-2026-09-19.md), the
[corrected result](GATEWAY-PILOT-CORRECTED-2026-09-19.md), and the
[invalid confirmation v1 block](CONFIRMATION-V1-INVALID-2026-09-19.md). The v2
block also [stopped on an overly tight stock safety cap](CONFIRMATION-V2-INVALID-2026-09-19.md).
V3 then [exposed an EOF range handling defect](CONFIRMATION-V3-INVALID-2026-09-19.md).
The implemented successor is the [confirmation v4 protocol](CONFIRMATION-V4.md).

The next benchmark compares three arms on the same larger investigation tasks:

1. **Stock Codex** uses normal efficient native search and reads. It is not forced
   to dump entire files or follow an artificial workflow.
2. **Local gateway** uses the plugin tools with no Jev key, producing the explicit
   deterministic local fallback.
3. **Jev gateway** uses the same plugin inputs with `jev-1.13.0` configured.

The fixture and expected-answer oracle are frozen before any arm runs. Each arm
uses Sol High, the same reasoning effort, a fresh authenticated Codex task, the
same task prompt, and the same execution timeout. Arm labels remain hidden from
the correctness grader.

Task requirements describe only the categories of facts to retrieve. They must
not contain oracle values. The stock command path is preflighted under its actual
execution policy, and any tool-router error invalidates the run immediately.

Record for every run:

- Codex input, cached-input, and output tokens;
- Codex tool calls and elapsed wall time;
- exact answer and blinded correctness score;
- selector mode and warnings;
- Jev requests, model, input/output tokens, latency, and raw typed scores;
- failures, timeouts, malformed events, and retries (retries are prohibited).

Primary success criterion: the Jev arm reduces median Codex input tokens by at
least 20% versus stock with no correctness regression. Report total cost using
the actual Codex and Jev prices in effect on the run date. Local and Jev arms must
use the same candidate construction and response caps. Any auth failure,
configuration drift, fixture drift, hidden retry, or missing usage field
invalidates that run rather than being imputed. A correctness miss is recorded
as a measured result and does not abort the remaining executions.

Run a two-task pilot first. Inspect the recorded commands and event logs before
authorizing the full matrix. Do not reuse profiles or launch duplicate batches.
