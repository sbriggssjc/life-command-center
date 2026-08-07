# Prompt 78 — Fix the PGRST204 schema-drift writers (top U4 finding, ~7k failed writes)

**Grounding:** `docs/audits/systemic-findings/2026-08.md` + live `ingest_write_failures` (the U4
report's #1 critical cluster): **dialysis 400·PGRST204 = 3,702** and **government 400·PGRST204 =
3,243** in 30 days — a writer sends field(s) the target table lacks, every one a silently lost
write. Also named in the same stub list (fold in if the root causes are adjacent):
`propagateToDomainDbDirect:last_ingested_at` (702, dia) and `backfillListingSaleIdForListing`
(505, dia).

## Do

1. **Diagnose from the log, not by guessing:** `ingest_write_failures` rows carry the caller/
   context + error payload — PGRST204's message names the missing column. Group by
   (caller, table, missing column) to enumerate the drifted field(s) per writer. Expect a small
   number of writers producing thousands of failures.
2. **Fix each writer** per the doctrine: drop or rename the stray field (fill-blanks-safe); if the
   field SHOULD exist, that's an additive migration to the domain table instead (deploy-ordering:
   migration first). Check both dia and gov arms of shared writers.
3. **Backfill decision per writer:** if the failed writes carried data still worth landing (e.g.
   last_ingested_at stamps), re-run the writer's natural sweep; do NOT replay raw failure payloads
   blindly.
4. **Regression guard:** a test asserting each fixed writer's field list against a schema-pinned
   column set (the prompt-72 pattern), so drift breaks tests instead of production writes.
5. Verify post-fix: PGRST204 cluster rate drops to ~0 in `v_lcc_w8_u4_ingest_failure_clusters`
   (the September U4 report becomes the measured proof).

Acceptance: named writers fixed + tested; failure clusters quantified before/after in the response.
Commit with the repo trailer.
