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
    -> one targeted Jev recovery pass if a required fact is still missing
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
- `read_selected_evidence`: retrieves a wider bounded range or complete selected
  small file from the same session; ranges stop safely at EOF.
- A focused skill that tells Codex when to use those tools.

Small candidate packets bypass Jev. Eligible large packets use Jev when
`TYPESAFE_API_KEY` is available. Authentication, network, malformed-response, or
timeout failures make one attempt and then return a clearly labeled local
fallback. No retry loop is hidden from the user.

When selected evidence is incomplete, Codex can identify the missing fact and
make one more targeted Jev-assisted selection with a changed question,
requirements, or known large file. The second pass remains subject to the same
path and size protections and returns its own session for bounded follow-up
reads. A sufficient first pass makes no recovery request; a failed Jev attempt
is not retried. These investigation-wide limits are agent guidance rather than
cross-call enforcement inside the MCP server.

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

### Save your API key once

The plugin reads `TYPESAFE_API_KEY` from the environment that launches Codex.
Save it persistently so it is available in future tasks and after restarts.
Copying a key to the clipboard does not configure the plugin, and setting
`$env:TYPESAFE_API_KEY` in one PowerShell session does not save it for future
Codex launches.

On Windows:

1. Open Start and search for **Edit environment variables for your account**.
2. Under **User variables**, choose **New** (or **Edit** if it already exists).
   Set the variable name to `TYPESAFE_API_KEY` and the value to your raw TypeSafe
   API key, without quotes or a `Bearer ` prefix.
3. Save with **OK** and close the settings dialogs. This user setting survives
   computer restarts and plugin updates; you only need to change it when your
   key changes.
4. Let running tasks finish, then **fully quit and reopen Codex** from the Start
   menu. For the CLI, close and reopen your terminal before launching Codex.
   Opening another task in the already-running app does not refresh its inherited
   environment.

To confirm that Windows has saved the variable without displaying the key, run
this in PowerShell:

```powershell
-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY', 'User'))
```

`True` confirms that a value is saved; it does not validate the key or prove the
currently running plugin has received it. Check actual Jev use as described below.

On other operating systems, persist the same variable in the environment that
launches Codex, then fully restart Codex. A variable set only in a terminal does
not configure a separately launched desktop app.

Keep the key outside plugin files, prompts, command arguments, and Git. The
plugin already forwards this named environment variable to its MCP server; no
key needs to be added to `.mcp.json`.

### Confirm installation and Jev use

Start a new Codex task after installation or upgrade. Confirm discovery with:

```powershell
codex plugin list
codex mcp list
```

The MCP list should include `jev_token_saver`. Discovery alone does not confirm
that your API key is available or that Jev has been used.

On an eligible large investigation, inspect the tool result for `mode: "jev"`
and `metrics.jevRequests: 1`. Together these confirm that Jev supplied the
selection. You do not need to enable diagnostics to see these fields. A small
packet may correctly return `bypass` without testing the key; `local-fallback`
means the plugin used its local selector, so inspect its warning before
attributing that result to Jev.

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
numbers are published, but they are not presented as proof. The
[corrected six-run pilot](docs/GATEWAY-PILOT-CORRECTED-2026-09-19.md) passed the
20% no-regression gate with 36.07% lower median Codex input than stock. It is a
promising two-task result, not a universal savings claim. The next
[controlled evaluation protocol](docs/NEXT-EVALUATION.md) calls for repetitions
before generalizing the percentage.

Confirmation v1 was [invalidated by a brittle grader](docs/CONFIRMATION-V1-INVALID-2026-09-19.md),
V2 by an [overly tight stock safety cap](docs/CONFIRMATION-V2-INVALID-2026-09-19.md),
and V3 by a [selected read past EOF](docs/CONFIRMATION-V3-INVALID-2026-09-19.md).
Each remains public and immutable. Plugin 0.3.1 safely capped selected ranges at
EOF. Version 0.3.2 adds one informed Jev recovery pass when required evidence is
missing; the published v4 savings numbers predate that recovery behavior.
[Confirmation v4](docs/CONFIRMATION-V4.md) replaced every exposed task and
retained the 12-task, three-repetition, rotated-arm design, task-level confidence
intervals, correctness outcomes, and combined-cost gates. Its
[final 108-run result](docs/CONFIRMATION-V4-FINAL-2026-09-20.md) found a 39.2%
paired input-token reduction versus stock (95% CI 19.4% to 56.2%) and 7.9%
versus local selection (95% CI 4.1% to 12.0%). Combined cost was lower than
both. A subsequent [quality audit](docs/CONFIRMATION-V4-QUALITY-AUDIT-2026-09-20.md)
found that the secondary rubric added unsupported positive/nonzero and zero-case
requirements that were absent from the tasks and fixtures. Applying the
evidence-grounded correction consistently yields 36/36 for Jev, stock, and
local selection. The original 33/36, 34/36, and 32/36 rubric outcomes remain in
the immutable raw record, but they do not establish substantive answer errors
or a Jev quality regression. The raw answers, measurements, blinded reviews,
mapping, and hashes are public under
[`benchmarks/results/confirmation-v4-2026-09-20`](benchmarks/results/confirmation-v4-2026-09-20/).

## Troubleshoot or remove

If `jev_token_saver` is missing, confirm the plugin is enabled, run
`codex plugin marketplace upgrade jev-codex-token-saver`, reinstall the plugin,
and start a new task.

If calls show `local-fallback`, inspect the returned warning:

- **`TYPESAFE_API_KEY is not configured`**: follow [Save your API key
  once](#save-your-api-key-once), then fully quit and reopen Codex. A saved Windows
  user variable is not automatically added to an already-running Codex or MCP
  process.
- **Authentication failure / HTTP 401**: check that you saved the raw, valid
  TypeSafe API key. After correcting or rotating it, restart Codex again.
- **Network, timeout, or response errors**: the plugin returns local evidence
  after one attempted Jev request. Check the reported error before trying a new
  investigation; the plugin does not automatically retry the failed request.

`bypass` is expected for small results and does not indicate an authentication
problem. Successful Jev selection reports `mode: "jev"`; a reduction reported
by `local-fallback` is a local-selection result.

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
