# Confirmation v4 quality audit

Status: complete. This audit changes the public interpretation of answer
quality while preserving every original run, answer, review decision, mapping,
and hash.

## Finding

The recorded secondary semantic scores—Jev 33/36, stock 34/36, and local
32/36—follow the later rubric as written. They do not represent nine
substantively incorrect answers. Every failure resulted from requirements that
the rubric added but the task evidence did not establish.

Removing only those unsupported penalties gives this retrospective,
evidence-grounded result:

| Arm | Original rubric | Corrected assessment |
|---|---:|---:|
| Stock Codex | 34/36 | 36/36 |
| Local selection | 32/36 | 36/36 |
| Jev selection | 33/36 | 36/36 |

This is an audit of existing records, not a rerun or a new prospective blinded
review. Two separate read-only audits checked the task definitions, fixtures,
answers, tool transcripts, reviewer decisions, and paired comparison.

## What the task evidence supported

For the inventory and catalog incidents,
`benchmarks/confirmation-v4-tasks.mjs` required the direct failure,
responsible configuration, first two application frames, smallest safe
correction, and a regression check. Its original correction matchers explicitly
accepted a valid supported setting; its test matcher did not prescribe a zero
boundary test.

The generated fixtures supplied only:

- an invalid-configuration exception;
- the first two application stack frames;
- confirmation that execution stopped before external side effects; and
- a generic runbook asking for a bounded correction.

They did not contain validator code, a rejected literal, an accepted range, or
a definition of zero behavior. The committed fixture hashes match the frozen
manifest.

The later rubric in `benchmarks/confirmation-v4-semantic-review.mjs` required
the inventory and catalog answers to state that the setting must be positive
and nonzero and to test zero/invalid against a positive successful case. Those
may be sensible implementation recommendations, but the supplied evidence
cannot make them mandatory facts.

## Affected answers

The three affected Jev runs were:

- `035-inventory-pool-incident-r1-jev`
- `069-catalog-batch-incident-r2-jev`
- `080-catalog-batch-incident-r3-jev`

Each identified the correct incident, exception, configuration setting, and
stack frames. Each proposed replacing the invalid setting with a value accepted
by the relevant validator or policy. Each proposed a regression check covering
invalid behavior, and each included a successful valid-configuration case.
Their saved Jev evidence packets retained the underlying incident details. The
positive/nonzero constraint was absent from the full fixture, so its absence
from selected evidence is not evidence that Jev dropped it.

The same unsupported criteria account for four local failures and two stock
failures:

- local: `034-inventory-pool-incident-r1-local`,
  `015-catalog-batch-incident-r1-local`,
  `068-catalog-batch-incident-r2-local`, and
  `079-catalog-batch-incident-r3-local`;
- stock: `071-inventory-pool-incident-r2-stock` and
  `081-catalog-batch-incident-r3-stock`.

All nine correctly identified the cause and locations. All proposed a relevant
regression check. Eight explicitly included a successful valid-configuration
case. The remaining stock answer proposed an invalid-input fail-fast check,
which still satisfies the task's generic request for a regression check.

## What changes and what remains historical

The raw reviewer JSON remains unchanged because it is a faithful record of the
rubric decisions. The original blinded scores should be described as historical
rubric outcomes, followed by the corrected evidence-grounded assessment. They
should not be used to claim Jev produced a worse answer.

The efficiency measurements are unaffected. In the completed suite, Jev used
54.25% fewer aggregate Codex input tokens, 31.89% less aggregate elapsed time,
and 44.83% lower combined API-equivalent cost than stock. Against deterministic
local selection, the corresponding reductions were 10.90%, 4.38%, and 8.75%.
The preregistered task-paired input reductions were 39.2% versus stock (95%
bootstrap interval 19.4% to 56.2%) and 7.9% versus local (4.1% to 12.0%).

The corrected conclusion is that this synthetic benchmark found substantial
efficiency gains and no substantive quality loss in the disputed answers. It
does not prove universal parity: there were 12 synthetic tasks repeated three
times per arm, the stock and assisted arms used different prescribed tool
workflows, and the semantic rubric was frozen only after Block 1. A prospective
replication should freeze the corrected rubric before execution and use
independent real repositories.
