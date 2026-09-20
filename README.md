# Jev Codex Token Saver

Jev Codex Token Saver is a local Codex plugin that reduces the amount of search
and log data sent back to Codex. Its MCP server gathers evidence locally, sends a
bounded candidate packet to Jev for typed relevance scoring, and returns only the
selected exact excerpts.

The useful intervention point is **before** a large tool result enters Codex
context:

```text
Codex question
    -> local workspace scan or large-file grouping
    -> bounded candidates
    -> Jev typed evidence selection
    -> a few exact excerpts returned to Codex
    -> optional exact follow-up read
```

This is not a replacement for native Codex compaction. It does not rewrite
history, intercept native tools, or claim that every task will use fewer tokens.
It gives Codex purpose-built tools for broad investigations where raw results
would otherwise be large.

## What the plugin adds

- `search_workspace_evidence`: searches an authorized local workspace and
  returns selected file excerpts.
- `read_large_text_evidence`: groups a large text or log file, keeps error and
  stack-trace blocks intact, and returns selected line ranges.
- `read_selected_evidence`: retrieves an exact wider range or complete selected
  small file from the same bounded session.
- A focused skill that tells Codex when to use those tools.

Small candidate packets bypass Jev. Eligible large packets use Jev when
`TYPESAFE_API_KEY` is available. Authentication, network, malformed-response, or
timeout failures make one attempt and then return a clearly labeled local
fallback. No retry loop is hidden from the user.

## Install

Requirements:

- Codex CLI/Desktop with plugin support
- Node.js 22.12 or newer
- A TypeSafe Jev API key for Jev selection (the local fallback works without it)

Add this GitHub repository as a marketplace and install the plugin:

```powershell
codex plugin marketplace add https://github.com/jcressler/jev-codex-token-saver
codex plugin add jev-codex-token-saver@jev-codex-token-saver
```

Set `TYPESAFE_API_KEY` in the environment that launches Codex. Do not put the
key in plugin files, prompts, command arguments, or Git. On Windows, one option is
to add it through **System Properties -> Environment Variables**, then fully
restart Codex so the bundled MCP process inherits it.

Start a new Codex task after installation or upgrade. Confirm discovery with:

```powershell
codex plugin list
codex mcp list
```

The MCP list should include `jev_token_saver`.

## Use

Ask Codex naturally:

> Use Jev Codex Token Saver to investigate why checkout initialization fails in
> this workspace. Establish the failing call site and the controlling config.

The tool response always identifies its selector mode:

| Mode | Meaning |
|---|---|
| `jev` | One Jev request selected from an eligible bounded candidate packet. |
| `bypass` | The packet was small enough to return without Jev. |
| `local-fallback` | Jev was unavailable or invalid; deterministic local ordering was returned with a warning. |

Use `includeDiagnostics: true` only while evaluating or debugging. Normal calls
omit raw scores and most selector telemetry to avoid adding those tokens back to
Codex context.

## Data and boundaries

The local MCP server reads only the workspace root supplied to a tool call.
Follow-up reads are limited to paths selected in that session. Absolute child
paths, `..` traversal, symlink escapes, binary files, `.env` files, and common
credential/key filenames are rejected.

For an eligible request, TypeSafe receives:

- the investigation question;
- up to six short requirements;
- relative candidate paths;
- bounded candidate excerpts; and
- typed yes/no probability questions.

TypeSafe does not receive the API key in the request body, the complete
workspace, or files excluded by the scanner. The key is used only in the bearer
authorization header. This is a conservative exclusion policy, not a full secret
redactor; use Jev only for content authorized for transfer.

Current safety caps include 20 candidates, 8 returned evidence blocks, a 48 KiB
Jev request, 8 MiB large-file reads, 256 KiB complete-file follow-ups, and 400
lines per ranged follow-up. These are maximums, not targets.

## Develop and verify

```powershell
npm install
npm run build
npm test
npm run check
npm run demo
```

`npm run demo` creates a 647 KB noisy log, selects the causal error and stack
trace, and reports candidate versus returned packet sizes without making a paid
request. The test suite covers bypass, relevant evidence amid noise, critical
error retention, exact deduplication, follow-up retrieval, API and malformed
response fallback, workspace and sensitive-path exclusions, plugin config, MCP
discovery, and a real stdio tool call.

The [architecture notes](docs/ARCHITECTURE.md) describe the trust boundary and
selection flow. The first six-run gateway pilot was
[invalidated and audited](docs/GATEWAY-PILOT-2026-09-19.md); its descriptive
numbers are published, but they are not presented as proof. The corrected
[controlled evaluation protocol](docs/NEXT-EVALUATION.md) retains the same
20% no-regression success criterion.

## Troubleshoot or remove

If `jev_token_saver` is missing, confirm the plugin is enabled, run
`codex plugin marketplace upgrade jev-codex-token-saver`, reinstall the plugin,
and start a new task. If calls show `local-fallback`, ensure the key exists in the
Codex process environment and inspect the returned warning. `bypass` is expected
for small results.

Remove the plugin and its marketplace with:

```powershell
codex plugin remove jev-codex-token-saver@jev-codex-token-saver
codex plugin marketplace remove jev-codex-token-saver
```

## Evidence and claims

The repository retains earlier exploratory and controlled results under
[`benchmarks/`](benchmarks/). They motivated the gateway design but do not prove
a universal savings rate. The current release reports its internal packet sizes
and Jev usage honestly; end-to-end savings require paired Codex runs with the
same model, task, fixture, quality gate, and tool policy.

Licensed under MIT.
