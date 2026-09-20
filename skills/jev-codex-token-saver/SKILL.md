---
name: jev-codex-token-saver
description: Use the bundled evidence tools for broad workspace searches or large text and log investigations so Jev can select evidence before bulky results enter Codex context.
---

# Jev Codex Token Saver

Use this skill when an investigation would otherwise require a broad search or a
large text/log read. Skip it for a known small file, a narrow exact lookup, or a
small edit.

Call `search_workspace_evidence` for a multi-file investigation. Supply the
absolute authorized workspace root, a concrete question, and separate
requirements for facts the answer must establish. Call
`read_large_text_evidence` when the likely evidence is in one large text or log
file. Both tools gather and preprocess locally inside the call. Eligible large
candidate packets use Jev automatically when `TYPESAFE_API_KEY` is configured;
small packets report `bypass`, and unavailable or invalid Jev responses report
`local-fallback`.

Use `read_selected_evidence` with the returned session ID for a wider bounded
line range or a complete selected small file. The end line is capped safely at
EOF and the range limit. Do this before edits or consequential claims when the
selected excerpt does not provide enough context. The follow-up tool can only
read paths selected in that session.

Make at most one search or large-text call for an investigation. Do not
reformulate or retry when Jev returns no evidence or the tool rejects an input;
report that result. After a successful selection, use only
`read_selected_evidence` for additional context.

Treat `candidateLimit`, `resultLimit`, file-size limits, and scan limits as safety
caps rather than quotas. Do not inflate a request to reach a cap. Keep
`includeDiagnostics` false during normal work; enable it only for evaluation or
selector debugging because raw scores and usage add context tokens.

The Jev request contains the question, requirements, relative paths, and bounded
candidate excerpts. Credential-like files are excluded. Never print, store, or
pass `TYPESAFE_API_KEY` as a tool argument. A reported packet reduction compares
the internal candidate packet with returned evidence; it is not an end-to-end
Codex token-savings claim.

These tools do not intercept native Codex tools, modify native compaction, or
rewrite conversation history. Use them at the start of eligible investigations
so large raw results never enter the model context.
