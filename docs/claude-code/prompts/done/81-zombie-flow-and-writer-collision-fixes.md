# Prompt 81 — Ops cleanup: zombie flow logging + dedup/FK/ON-CONFLICT writer fixes

**Grounding:** U4's 2026-08 stub list, remaining items after 78:

1. **`Unflag Completed Email Tasks` — 524 logged failures** through 2026-07-29, but STATUS records
   this flow as RETIRED/Off (consolidated into LCCToDoCompletionPoll). Diagnose: is the flow
   actually still running (zombie — turn it off for real / have Scott do it in PA), or are these
   stale rows the health surface should have aged off (fix the retention/resolution sweep so
   retired-flow failures auto-resolve)? Same check for `To Do - Life Command Center Sync` (131).
2. **dia 409·23505 = 1,837 + gov 384 (dedup collisions):** identify the INSERT path(s); fold the
   colliding row into the dedup path (mark superseded / upsert on the natural key) instead of
   aborting — the R37 dedup-respect rule. These are mostly re-ingested known rows, not data loss,
   but they pollute the failure signal.
3. **dia 409·23503 = 494 (FK violations):** writes referencing missing/repointed parents — trace
   the caller; resolve-or-create parent first (or route to review), never a dangling abort.
4. **gov 400·42P10 = 243 (ON CONFLICT inference mismatch):** the known footgun — use the
   index-inference/expression form matching the live unique index, not ON CONSTRAINT. Find the
   writer and fix per the CLAUDE.md rule.
5. **`upsertSidebarContacts` entityUpdate/personUpdate 409s (336):** likely the same 23505 class
   via the sidebar path — fix with (2).

Each fix: quantify before-counts from `v_lcc_w8_u4_ingest_failure_clusters` /
`v_lcc_w8_u4_flow_failure_clusters`, patch the single writer (fill-blanks-safe, reversible where
applicable), regression-test, report expected after-state (September's U4 report is the proof).
Anything requiring a Power Automate change (zombie flow) = report + exact steps for Scott, don't
guess-modify flows.

Commit with the repo trailer.
