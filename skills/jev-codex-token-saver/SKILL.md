---
name: jev-codex-token-saver
description: Investigate broad local code, logs, or documentation with a bounded search packet so Codex receives a few relevant excerpts instead of a large raw result set.
---

# Jev Codex Token Saver

Use this skill when an investigation would otherwise require broad searches or
large log/file reads. It is most useful for multi-file diagnosis and repeated
fact lookup; skip it for a known file, a small edit, or a narrow exact search.

Run the bundled script with an explicit authorized workspace root and a concrete
query. Add requirements for distinct facts the answer must establish:

```sh
node "${PLUGIN_ROOT}/scripts/investigate.mjs" \
  --root PATH \
  --query "why does checkout initialization fail" \
  --requirement "the failing call site" \
  --requirement "the configuration that controls it" \
  --jev --allow-network
```

Use `--jev --allow-network` only when the user has authorized sending the query,
requirements, relative paths, and bounded source excerpts to TypeSafe. Jev mode
requires `TYPESAFE_API_KEY` in the Codex process environment. Never print, store,
or pass the key on the command line. Without authorization or a key, omit both
flags and use the deterministic local ranking.

Treat returned excerpts as leads. Open the selected exact source locations when
the task requires code changes or consequential conclusions. If the report says
`local-fallback`, Jev did not complete successfully. Check `scanTruncated` and
the skip counters before treating missing evidence as proof of absence.

The reported reduction compares the bounded candidate packet with the returned
evidence packet. Do not describe it as measured Codex savings unless a separate
controlled Codex run records the actual input tokens and equivalent task quality.
The tool does not modify native compaction, intercept arbitrary Codex tools, or
change source files.
