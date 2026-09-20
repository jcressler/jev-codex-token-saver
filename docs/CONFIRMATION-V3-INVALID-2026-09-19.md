# Confirmation v3 invalid block

Status: invalid after four launches. The block was not resumed or retried.

The first task completed all three arms correctly. On the fourth execution,
live Jev selected the correct source, test, and documentation evidence for a
cancellation bug. Codex requested lines 1 through 20 from the selected source,
which contained 11 lines. `read_selected_evidence` rejected the end line. The
model still returned a fully correct answer from the initial evidence packet,
but the frozen policy treated the failed follow-up read as execution invalid.

This exposed a plugin usability defect. A caller can safely name a selected
path and bounded range without knowing its exact EOF. Version 0.3.1 now clamps
the requested end line to the selected file's end and the existing 400-line
limit. It still rejects an invalid start line, an end before the start, an
unselected path, traversal, excessive returned characters, and complete reads
above the byte limit.

The one completed comparison is descriptive only: Jev used 57,206 Codex input
tokens, local used 59,283, and stock used 114,980; all three answers were
correct. The block is too incomplete for a performance claim.

[Confirmation v4](CONFIRMATION-V4.md) replaces both tasks observed in v3 and
freezes the rebuilt 0.3.1 MCP bundle.
