# Prompt 23 — Comps: appraisal-scale query shaping (engine is fine; defaults under-serve)

## Why
Full triage in `docs/comps-rollout/comps-query-shaping-triage-2026-08-03.md`. Verified against Dialysis_DB:
3,022 live sold dialysis comps (1985–2026, 48 states, 100+ FL); `rpc_query_comps` serves them (limit=100→100).
But agents (ChatGPT/Copilot) only saw 3–9 because of three compounding, non-bug causes:
(1) reliability gate ON by default excludes imputed-cap comps (most dialysis); (2) small default limits
(query 40 / synth 25) + the RPC is most-recent-first (`top … order by sort_date desc limit p_limit`), so small
limits return only the newest few; (3) `p_tenant` is a single ILIKE substring, so a multi-operator string
(“DaVita, Fresenius, US Renal…”) matches ~nothing → the observed "1 record".

## Task (mcp/comps-tools.js + the comps-engine skill; do NOT change the DB RPC unless step 2 needs it)
1. **Appraisal / full-set mode.** Add an explicit mode (arg like `appraisal:true` or `full_set:true`) to
   `query_comps`/`synthesize_comps` that sets: `include_unreliable_noi=true`, `p_tenant=NULL`, a high limit
   (e.g. 150), and geo-tiering support. Update the `comps-engine` skill so appraisal/"comps for the appraiser"
   requests use it by default. Keep the strict reliable-only path as the non-appraisal default.
2. **Rank before truncate.** Today the RPC caps to the most-recent `p_limit` BEFORE similarity ranking, so big
   pulls skew recent/national over similar/FL. Either (a) have the engine request a larger candidate pool then
   rank+cap in JS, or (b) add an RPC ordering/param so geo+similarity precedes the recency cap. Preserve the
   most-recent default for non-appraisal quick pulls.
3. **Multi-operator tenants.** Accept a tenant LIST (or split `p_tenant` on commas server-side) so
   "all operators" / a list doesn't collapse the ILIKE to zero. When the caller wants every operator, pass NULL.
4. **Surface the exclusion count.** In the agent/markdown output, when `excluded_unreliable_noi > 0`, say so
   explicitly ("N shown; M excluded as estimated-NOI — include estimated NOI to see them") so it's never silent.

## Verify
- `query_comps` appraisal-mode, dialysis, FL → returns a deep FL set incl. pre-2025 sales (not just the newest).
- A multi-operator request ("DaVita, Fresenius, US Renal") returns comps from all three (not 0–1).
- Non-appraisal default behavior unchanged (reliable-only, recent-first).
- `synthesize_comps` for "dialysis comps for The Villages FL appraisal" yields 20–30 FL-weighted comps with the
  excluded-count surfaced.

## Note
No DB data problem — do not "load more comps." The 3,022 are already there and served; this is engine/skill
query-shaping + presentation so appraisal-scale pulls aren't throttled by defaults meant for quick lookups.
