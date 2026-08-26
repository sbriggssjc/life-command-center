# Prompt 82 — Close the provider-stamp coverage gap (blocks a clean W5.3 re-grade)

**Grounding (live, 2026-08-08):** since the prompt-61 deploy, only **4 of 15** new
`staged_intake_extractions` rows carry `extraction_snapshot._provider` (also flagged as a U4
finding: 4/569 over 30d). The stamp was added to `processIntakeExtraction`'s snapshot write, but
some extraction path(s) still write snapshots without it.

## Do (small)

1. Enumerate every writer of `staged_intake_extractions` (grep the INSERT/POST paths — candidates:
   the OCR/vision path, re-extract/force paths, the sidebar pipeline, the Copilot stage-om channel,
   admin re-runs). For the 11 unstamped rows, identify which path wrote them (raw_payload/channel
   forensics) — fix THAT path, and any other bare writers found.
2. Route all of them through the shared `buildProviderStamp` helper (prompt-61 module) — one stamp
   shape, no forks. If a path genuinely has no AI call (e.g. a manual re-stage), stamp
   `{final_provider:'none'}` rather than omitting — absence should mean "old row", never "unknown
   path".
3. Structural test: every code path that writes `extraction_snapshot` includes `_provider` (grep
   guard on the writer modules).

Acceptance: fresh extractions stamp at ~100%; the W5.3 re-grade (at ~50 rows) can split
ollama/cloud cleanly. Commit with the repo trailer.
