# Architecture and trust boundary

The plugin uses the supported Codex compatibility package: a manifest, a focused
skill, and a bundled local stdio MCP server. The server exposes three read-only
tools and inherits `TYPESAFE_API_KEY` from the Codex process. The key is never a
tool argument or response field.

## Selection flow

1. Codex sends an explicit workspace root, question, and optional requirements
   to one evidence tool.
2. The MCP process scans or reads locally and creates a bounded candidate packet.
3. Packets at or below the small-result threshold bypass Jev.
4. Eligible packets make one `jev-1.13.0` request when a key is configured.
5. Jev returns typed probability answers. Coverage-aware selection chooses up to
   the requested result cap; critical error blocks remain present.
6. The tool returns exact paths, line ranges, excerpts, selector mode, and compact
   metrics. Raw scores are included only when diagnostics are requested.
7. A short-lived session permits exact follow-up retrieval only for selected
   paths under the same canonical workspace root.
8. If a required fact remains missing, Codex may make one informed recovery
   selection with a narrower question, new requirements, or another known large
   file. That pass creates a separate session and retains all normal caps.

Jev is a selector, not a generator or authorization boundary. A probability
threshold is a conservative prototype policy and must be calibrated on labeled
tasks before being treated as a quality guarantee.

## Local preprocessing

Workspace search excludes generated dependency directories, common secret/key
filenames, binary files, over-limit files, and symlinks. Large-file processing
builds overlapping text blocks, combines error lines with their stack traces,
deduplicates exact block repeats, and includes critical blocks in the bounded
candidate set.

The server validates canonical roots and rejects traversal or symlink escapes.
Resource caps bound file count, bytes scanned, file size, candidate count, Jev
request size, returned evidence, and follow-up size. Reaching a cap is reported
as truncation; it is never treated as proof that missing evidence does not exist.

## Failure behavior

Eligible calls attempt Jev once. A missing key makes zero paid requests. An API,
authentication, timeout, or malformed-answer failure makes no retry and returns
deterministic local evidence with `mode: local-fallback` and a warning. Small
packets use `mode: bypass`; this is normal operation, not a fallback.

## Informed recovery

The initial selection remains the normal path. Codex first expands a selected
source with `read_selected_evidence` when that can resolve the gap without a new
selection. A second selection is reserved for an explicit missing fact and must
change the query, requirements, or target file based on evidence from the first
pass. It is another bounded tool call: new candidates are gathered locally,
eligible packets make at most one Jev request, and only selected exact excerpts
enter Codex context.

The two-pass investigation limit is guidance supplied by the plugin skill and
MCP server instructions; the MCP process does not maintain cross-call counters.
Each call independently reports its mode and Jev request count. If the first
call reports Jev failure and local fallback, the guidance prohibits a second Jev
attempt. Ordinary authorized investigation remains available after one informed
recovery pass when the task cannot otherwise be completed, but it is a last
resort rather than the default recovery route.

Recovery does not widen access. Sensitive-path exclusions, canonical workspace
checks, symlink rejection, file and packet caps, and session-scoped follow-up
reads apply unchanged. Failure to select evidence is never proof that the fact
does not exist.

## Scope

The plugin works only when Codex chooses its evidence tools. It does not intercept
shell commands, built-in file reads, or other MCP tools. It does not alter native
compaction, encrypted reasoning state, prompt caching, or conversation history.
