# Live Jev smoke test — 2026-09-19

This smoke test used the prototype repository as its own authorized search root.
The Jev API key was provided through a temporary process environment variable,
was not printed or stored, and was cleared after the request.

## Fixed input

- Query: `How is Jev network authorization enforced and how does failure fall back safely?`
- Requirement 1: `the explicit network authorization gate`
- Requirement 2: `the deterministic fallback behavior`
- Candidate limit: 6
- Result limit: 2
- Jev model: `jev-1.13.0`

## Live Jev result

- Mode: `jev`
- Requests: 1
- Selected: `scripts/investigate.mjs`, `tests/investigator.test.mjs`
- Candidate packet: 5,052 characters, approximately 1,263 tokens
- Returned evidence: 1,942 characters, approximately 486 tokens
- Candidate-packet reduction: 61.6%
- Jev usage: 3,042 input tokens and 388 output tokens
- Elapsed time: 501 ms
- Scan complete: yes

The selected source excerpt contained the explicit `--allow-network` and
`TYPESAFE_API_KEY` gates. The selected test excerpt contained the asserted
`local-fallback` behavior.

## Identical local control

- Mode: `local`
- Requests: 0
- Selected: `skills/jev-codex-token-saver/SKILL.md`, `README.md`
- Candidate packet: 5,052 characters, approximately 1,263 tokens
- Returned evidence: 1,609 characters, approximately 403 tokens
- Candidate-packet reduction: 68.2%
- Elapsed time: 15 ms
- Scan complete: yes

## Interpretation

The smoke test confirms that the real Jev request succeeds, returns typed
probabilities, and changes selection. For this implementation-focused query,
Jev selected executable source and a behavioral test while the local heuristic
selected documentation. The Jev packet was larger than the local packet, and no
independent grader scored answer quality. This run therefore demonstrates live
integration and a potentially useful selection difference, not a proven token
or quality advantage over local selection. End-to-end Codex savings require a
paired task that holds the Codex model, reasoning effort, task, and grader fixed.

## Version 0.3.0 MCP gateway verification

The release verification permits at most two live Jev requests and no automatic
retry.

- Attempt 1: failed closed as `local-fallback`. The clipboard contained non-key
  text with whitespace; the original preflight checked only that it was nonempty.
  The script made no retry and did not expose or store the clipboard contents.
- Correction: live preflight now requires one bounded opaque ASCII token with no
  whitespace before any request. TypeSafe keys do not all use the public
  quickstart's example prefix. A fallback result is printed with its warning
  before the smoke exits nonzero, so an API failure remains diagnosable.
- Attempt 2: passed with `mode: jev`. The 647 KB planted log produced 16
  candidates (47,773 characters, approximately 11,944 tokens); Jev returned the
  exact root cause and stack trace in one 580-character excerpt (approximately
  145 tokens). `jev-1.13.0` reported 9,665 input tokens, 1,046 output tokens, and
  666 ms selector latency. These are internal packet measurements, not Codex
  token savings.

## Installed Sol High integration smoke

The installed `0.3.0` plugin was discovered through Codex and its schema rejected
an out-of-range candidate limit before any Jev request. The subsequent valid call
used `jev-1.13.0`, but its top relevance score of 0.51 was vetoed by a separate
0.50 requirement-support threshold, so the tool returned no evidence. Sol then
violated the frozen smoke procedure by reformulating the search instead of using
the exact follow-up tool. That second call also returned no evidence. It was
interrupted immediately afterward.

Recorded Jev calls inside the failed integration smoke:

- Call 1: 12,318 input tokens, 1,764 output tokens, 785 ms, 20 candidates, no
  returned evidence.
- Call 2: 6,880 input tokens, 778 output tokens, 528 ms, 12 candidates, no
  returned evidence.

The correction removes the requirement-score veto while retaining the 0.50
relevance threshold, adds relative-path evidence signals, and adds an MCP server
instruction that prohibits search reformulation and retries. Those exact cases
are covered offline. No further live Jev or Codex calls were made after the
failed smoke. The rebuilt cached plugin passed offline stdio discovery, selection,
session creation, and exact follow-up retrieval. The corrected live
Jev-selected follow-up flow remains to be reconfirmed in a later explicitly
authorized smoke.
