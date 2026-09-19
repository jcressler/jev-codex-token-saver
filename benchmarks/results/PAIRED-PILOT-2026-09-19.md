# Paired pilot result — 2026-09-19

One frozen investigation, three arms, one execution per arm. This is a harness pilot, not a statistically powered comparison.

| Arm | Score | Pass | Input | Cached input | Output | Tool calls | Milliseconds | API-equivalent USD |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stock | 10/10 | yes | 106144 | 78848 | 3417 | 5 | 73404 | 0.209063 |
| local | 10/10 | yes | 109340 | 82688 | 3927 | 4 | 84240 | 0.218223 |
| jev | 10/10 | yes | 77503 | 53888 | 2655 | 3 | 64785 | 0.169115 |

Jev selector: jev, 1 request, 3721 input / 652 output tokens, 498 ms.

Packet sizes: local 1773 characters; Jev 1773 characters.

The local and Jev packets were byte-for-byte identical. Differences between those two Codex runs cannot be attributed to Jev selection.

Because the assisted packets were identical, their two Codex executions can only serve as repeated observations of the same evidence-assisted treatment. Their mean versus stock was -12% total input, -7.9% uncached input, -3.7% output, -30% tool calls, and 1.5% elapsed time. The two assisted input results individually ranged from -27% to 3% versus stock, which is too much single-run variance for a causal claim.

The Jev selector added 3721 input and 652 output tokens on TypeSafe plus 498 ms, while selecting the same packet as local. It provided no measured selector benefit on this task.

## Execution audit

- One Sol High stock attempt timed out after the Windows read-only sandbox rejected the bundled PowerShell process; no turn.completed usage was available.
- One runner attempt exited during CLI argument parsing before starting Codex.
- A second Sol High stock attempt timed out after the same Windows read-only sandbox rejection; no turn.completed usage was available.
- One Luna Low read-only diagnostic verified the replacement danger-full-access command path and is not part of the comparison.

All interpretations must preserve quality as the first gate. Native token counters are telemetry; API-equivalent prices do not represent Codex subscription usage. One execution per arm cannot establish a general advantage.
