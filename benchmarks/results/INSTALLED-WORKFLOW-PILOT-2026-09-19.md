# Installed workflow pilot — 2026-09-19

This pilot measured the actual installed Codex skill path. The Jev arm loaded the
skill, invoked the selector once, received a successful `jev` response, verified
selected locations, and produced its answer. Both arms used the same pinned
Codex executable, Sol High, read-only task, output schema, fixture, and rubric.
Both answers scored 10/10.

| Measure | Stock | Installed Jev | Jev change |
|---|---:|---:|---:|
| Codex input tokens | 70,085 | 101,326 | 44.6% more |
| Cached input tokens | 50,176 | 93,312 | 86.0% more |
| Uncached input tokens | 19,909 | 8,014 | 59.7% less |
| Codex output tokens | 1,174 | 2,124 | 80.9% more |
| Tool calls | 3 | 5 | 66.7% more |
| Elapsed time | 24.8 s | 39.1 s | 57.5% more |
| API-equivalent cost | $0.123186 | $0.112022 | 9.1% less |

The cost figure for the Jev arm includes its selector request. The selector used
3,831 input and 652 output tokens, took 0.52 seconds, and reduced its bounded
candidate packet from 4,860 to 3,156 characters (35.1%). Under the frozen v2
price assumptions, that request cost approximately $0.000161.

The result is mixed rather than a win on token usage. Jev increased total Codex
input, output, tool calls, and time on this small task. It reduced uncached input
enough that the API-equivalent cost was lower because cached input is priced much
more cheaply. This cost calculation is not a Codex subscription charge.

The intended follow-up used a broader real audit of the evaluation harness. Its
stock arm returned a semantically correct answer but used 161,589 input tokens,
crossing the fixed 150,000-token gate. The campaign stopped and did not launch a
Jev counterpart. Therefore it supplies no stock-versus-Jev comparison.

An obsolete-CLI preflight that made no model call and an HTTP 401
`local-fallback` attempt are excluded. The completed pair has only one task and
one execution per arm, so it does not establish a general performance effect.
