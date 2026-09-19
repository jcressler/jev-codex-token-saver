# Evaluation v2 result — 2026-09-19

Jev produced the best aggregate efficiency in this frozen Sol High campaign.
All 12 measured executions completed without a process failure, retry, timeout,
fixture mutation, or Jev fallback.

| Arm | Runs | Codex input | Cached input | Codex output | Tools | Time | API-equivalent Codex cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Stock | 4 | 317,625 | 278,144 | 11,969 | 22 | 292.589 s | $0.508562 |
| Local | 4 | 354,637 | 292,480 | 9,953 | 26 | 268.000 s | $0.564680 |
| Jev | 4 | **303,005** | **254,208** | **9,188** | **17** | **232.774 s** | **$0.480631** |

Jev selection added two TypeSafe requests: 6,547 input tokens, 1,304 output
tokens, 715 ms of ranking time, and $0.000275 at the frozen public TypeSafe
price. Including selector search and ranking, Jev took 233.500 seconds and its
combined API-equivalent cost was $0.480906.

Compared with stock, Jev used 4.6% fewer Codex input tokens, 23.2% fewer Codex
output tokens, 22.7% fewer tools, 20.2% less end-to-end time, and 5.4% lower
API-equivalent cost after adding the Jev charge.

Compared with local selection, Jev used 14.6% fewer Codex input tokens, 7.7%
fewer Codex output tokens, 34.6% fewer tools, 12.9% less end-to-end time, and
14.8% lower API-equivalent cost after adding the Jev charge.

The uncached-input result was more mixed: Jev used 48,797 uncached Codex input
tokens, versus 39,481 for stock and 62,157 for local. Its lower cached input,
output, tools, and elapsed time still produced the lowest API-equivalent total.

## Task-level interpretation

For the webhook task, Jev replaced a secondary documentation excerpt with the
actual signature implementation. Across two repetitions it used 177,337 input
tokens, versus 193,366 for stock and 212,839 for local; it also used the fewest
output tokens, tools, and time. This is the campaign's clearest evidence of a
useful Jev selection.

For the tenant-cache task, local and Jev selected the same two excerpts in
reverse order. Jev used 125,668 input tokens, versus 124,259 for stock and
141,798 for local. Its lower output, tools, and time are observed benefits, but
they cannot establish a Jev content-selection advantage because the evidence
content was the same.

## Quality audit

The frozen automated grader originally reported stock 4/4 passes, local 4/4,
and Jev 3/4. Its one failed Jev answer actually identified parsing before
authentication, loss of the original bytes, JSON reserialization, the raw-body
fix, and the exact missing regression cases. The mismatch came from an
over-escaped `JSON.parse` regex and literal phrase matching.

A uniform semantic audit of every sub-10 answer found the same false-negative
pattern across stock, local, and Jev answers. After that audit, all three arms
were 4/4 and 10/10. The original machine scores remain in the raw artifacts.
The semantic audit occurred after arm labels were known, so it is disclosed as
a corrective audit rather than an independent blinded grade.

## Limits

This is directional evidence from two small controlled tasks and two
repetitions per arm. It shows that this Jev workflow can reduce Codex work while
preserving answer quality on these tasks. It does not yet provide a stable
population estimate for arbitrary repositories. Native token counters are
telemetry; API-equivalent pricing does not measure Codex subscription or weekly
allowance consumption.
