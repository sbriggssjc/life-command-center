# Prompt 31 + 32 — live migration apply (2026-08-04)

Applied directly via Supabase MCP. **Machinery only — no destructive consolidation was run.**

## Applied
- **32 Ollama clean-assist** → LCC Opps (`xengecqvemvfknjvbvrq`): `lcc_clean_assist_proposals` + latest/health
  views + `OLLAMA_CLEAN_ASSIST` flag (state=off) + `ollama-clean-assist-tick` pg_cron (no-ops while flag off).
  Verified: flag off, health=amber/open=0, cron present.
- **31 dia** → Dialysis_DB (`zqzrriwuavgrquhisnoa`): p31 log tables, plan/review/history/census views, 3 RPCs.
  Cheap counts: **78 dup-address groups**, **969 repeat sales classified keep**, 132 nearby-review.
- **31 gov** → government (`scknotsqkcheojiaewwh`): same set. First attempt FAILED (rolled back) —
  migration called `public.gov_normalize_address(text)` which does not exist on gov. Fix: added a naming-parity
  shim `gov_normalize_address(text) -> gov_normalize_for_match(text)` (gov's real match normalizer, used by an
  existing view; mirrors dia_normalize_address), then re-applied. Cheap counts: **409 dup-address groups**,
  **1,650 repeat sales classified keep**, 183 nearby-review. Migration file patched with the shim so a fresh
  apply is self-contained.

## NOT run (needs Scott go-ahead — data mutation)
The `*_apply(p_dry_run := false)` calls were NOT executed. The full plan views exceed the 60s MCP timeout;
run the dry-run + apply from the Supabase SQL editor (no cap). Repeat sales stay distinct; apply only soft-tags
(duplicate_superseded / merged with reversible backup ledgers). Rollback: p31_*_log tables.

## Destructive apply RUN + verified (2026-08-04, per Scott go-ahead)
Added functional indexes (dia + gov) so the plan views compute in-window. Live results:
- **dia**: 12 property merges + 3 same-event supersessions. dup-address groups 78 -> 66; repeat sales kept 968.
- **gov**: 20 property merges + 8 same-event supersessions. dup groups 409 -> 389; repeat sales kept 1642.
  Two run-time fixes captured in 20260804b_gov_prompt31_apply_fixes.sql: (a) property_id is bigint ->
  cast to integer for gov_merge_property; (b) added p_limit so heavy gov merges apply in sub-60s batches
  (dropped the old 2-arg overload). All merges/supersessions logged + reversible (p31_*_log). Review lanes
  (dia 70+1, gov 6980+0) intentionally NOT auto-applied.
