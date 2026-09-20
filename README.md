# Jev Codex Token Saver

An experimental Codex plugin that reduces broad investigation output before it
enters the model context.

The prototype searches an authorized workspace locally, builds a bounded set of
exact excerpts, follows a few local imports from strong candidates, and optionally
makes one Jev request to score which excerpts answer the query and its requirements.
Codex receives only the selected evidence.
It does not rewrite conversation history or replace native Codex compaction.

## Why this design

Large search results, logs, and repeated file reads can consume more Codex input
than the useful evidence warrants. Jev is used here as a typed relevance scorer,
where its `Noul` probabilities fit the decision being made. File discovery,
bounds, exact excerpts, secret-like file exclusions, and fallback behavior stay
deterministic.

This is a prototype. Its `candidateContextReductionPercent` compares the bounded
candidate packet with the evidence packet returned to Codex. It is useful
instrumentation, but it is not proof of an equivalent percentage reduction in
Codex billing, subscription usage, or end-to-end task tokens.

## Install as a Codex plugin

Requirements: Node.js 22.12 or newer.

```sh
codex plugin marketplace add jcressler/jev-codex-token-saver
codex plugin add jev-codex-token-saver@jev-codex-token-saver
```

Start a new Codex task after installing so the skill is discovered.

## Run directly

Local deterministic selection needs no API key or network access:

```sh
node scripts/investigate.mjs \
  --root /path/to/project \
  --query "why checkout initialization fails" \
  --requirement "the failing call site" \
  --requirement "the controlling configuration"
```

For Jev selection, provide `TYPESAFE_API_KEY` through the process environment:

```sh
node scripts/investigate.mjs \
  --root /path/to/project \
  --query "why checkout initialization fails" \
  --requirement "the failing call site" \
  --requirement "the controlling configuration" \
  --jev --allow-network
```

Jev mode sends the query, requirements, relative paths, and bounded candidate
excerpts to TypeSafe. It defaults to the pinned evaluation model
`jev-1.13.0`. An invalid response, timeout, or request failure returns the local
ordering with `mode: "local-fallback"`.

Normal output is deliberately compact: mode, exact source locations, excerpts,
and essential warnings. Write the complete query, Jev scores, skip counters, and
telemetry to a separate file only when evaluating or debugging:

```sh
node scripts/investigate.mjs \
  --root /path/to/project \
  --query "why checkout initialization fails" \
  --jev --allow-network \
  --diagnostics ./jev-diagnostics.json
```

`--full` preserves the earlier verbose stdout format for direct debugging.

## Current safeguards and limits

- One Jev request, at most 20 candidate files, and a 48 KiB request cap.
- At most 4 imported local files are added by reference expansion by default;
  the total candidate cap still applies.
- At most 8 returned evidence excerpts.
- No symlink traversal.
- Common generated/dependency directories are skipped.
- `.env`, credential/secret-named files, private-key formats, and binary files are skipped.
- Default scan caps: 5,000 visited files, 64 MiB total text, 1 MiB per file.
- No source writes and no changes to Codex conversation history.

These exclusions are protective heuristics, not a complete secret scanner or
redactor. Use Jev mode only for content authorized for transfer.

## Validate

```sh
npm test
npm run check
```

The tests use a synthetic Jev adapter; they do not require a key or make network
requests. A useful next evaluation is a small paired Codex trial comparing the
same investigation with ordinary search output and with this evidence packet,
holding the Codex model, reasoning effort, task, and grader constant.

The first real API smoke test and its identical local control are documented in
[`docs/LIVE-SMOKE-2026-09-19.md`](docs/LIVE-SMOKE-2026-09-19.md). It verifies
the live integration and shows that Jev changed the evidence selection; it does
not establish end-to-end Codex token savings or general superiority.

A subsequent [Sol High paired pilot](benchmarks/results/PAIRED-PILOT-2026-09-19.md)
compared stock Codex with local- and Jev-selected evidence on one real defect.
All answers passed the audited grader. Local and Jev produced byte-for-byte
identical evidence, so their differing Codex usage cannot be credited to Jev.
Together, the two identical evidence-assisted observations averaged 12% fewer
total input tokens than stock, with wide single-run variance. The frozen
[protocol](benchmarks/PAIRED-PILOT.md) and JSON evidence are published alongside
the result.

The replacement [evaluation v2 protocol](benchmarks/EVALUATION-V2.md) freezes two
new tasks, balanced arm ordering, two repetitions, durable raw artifacts,
per-execution fixture hashes, strict launch caps, and fail-closed smoke and
budget gates. Its live stage is deliberately separate from offline preparation.

The completed [evaluation v2 result](benchmarks/results/EVALUATION-V2-2026-09-19.md)
ran all 12 frozen Sol High executions. Jev had the lowest aggregate Codex input,
output, tool use, elapsed time, and API-equivalent cost after its selector cost;
the report preserves the grader correction and the limits of the small sample.

The offline quality checks now include the previously rejected correct Jev
paraphrase, plausible wrong answers, executable reproductions of both fixture
defects, and a label-free review packet. Scores within one rubric item of passing
are marked for review instead of being treated as definitive automatic failures.

The [installed workflow pilot](benchmarks/INSTALLED-WORKFLOW-PILOT.md) measures
the whole Codex path, including skill discovery and the live Jev invocation. It
uses a pinned Codex binary, strict single-launch artifacts, per-run budgets, and
rejects `local-fallback` instead of mislabeling it as Jev.

MIT licensed. Independent community project; not affiliated with OpenAI or TypeSafe.
