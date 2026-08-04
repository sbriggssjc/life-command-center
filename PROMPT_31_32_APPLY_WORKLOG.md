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
