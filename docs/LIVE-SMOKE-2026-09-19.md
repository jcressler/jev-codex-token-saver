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
