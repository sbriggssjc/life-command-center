# Claude Code prompt — T9d REVERT (urgent): undo the exclusion-based rebuild, keep the one clean fix

> The shipped T9d (`20260626_cm_dia_t9d_authoritative_listing_currency.sql`) implemented the EXCLUSION
> approach that was explicitly rejected — it dropped 135 OM/flyer/email-evidenced listings from the active
> count and cleared `on_market_date` on 43 evidenced deals, collapsing dia active to 75 (2026-03) / 30
> (2026-06). Scott's standard: a listing is "available" if evidenced by an OM/flyer/email/fax/comp/capture —
> NOT only if it has a live URL/authoritative date. **Revert the destructive parts now (dia is live-wrong);
> keep the one good fix.** dia `zqzrriwuavgrquhisnoa`. Fully reversible (backup + git). Verified live 2026-06-26.

## Do (in order)
1. **Restore the cleared on-market dates (most urgent — evidence erased from 110 rows, incl. 43 with OM/flyer/
   email artifacts).** From the backup `cm_dia_t9d_on_market_sweep_backup` (110 rows, all restorable):
   ```sql
   UPDATE available_listings al
   SET on_market_date        = b.prior_on_market_date,
       on_market_date_source = b.prior_on_market_source,
       on_market_date_confidence = b.prior_on_market_conf
   FROM cm_dia_t9d_on_market_sweep_backup b
   WHERE al.listing_id = b.listing_id AND al.on_market_date IS NULL;
   ```
   (Guard `AND al.on_market_date IS NULL` so it only re-fills the swept rows. `trg_listing_close_if_sold` is
   currently ENABLED — keep it enabled; do NOT let the restore spuriously auto-close anything, the guard +
   the fact these are date-only updates should be safe, but verify no row flips to sold.)
2. **Restore the prior view bodies** of `cm_dialysis_active_listings_m` and `cm_dialysis_active_listings_q`
   from git (the commit immediately BEFORE the T9d migration) via `CREATE OR REPLACE VIEW`. Also restore
   `cm_dialysis_inventory_snapshot_kpis` and `cm_dialysis_inventory_backlog_m` if the migration altered them
   (the migration's deny-list / membership edits). Net: the dia active-listing view family back to its
   pre-T9d definitions.
3. **KEEP** the `lcc_record_listing_check` change (no longer advances `last_verified_at` on a no-probe
   `inferred_active` check) — that fix is correct and non-destructive; do NOT revert it.
4. **HOLD** the restatement footnote — do NOT merge PR #1354 (life-command-center); there is no valid
   restatement yet. Revert/abandon that footnote change.
5. **Do NOT drop** `cm_dia_t9d_on_market_sweep_backup` — the provenance-first rewrite will reuse it. Leave it.

## Gate (verify live, report)
- `cm_dialysis_active_listings_m` @ 2026-03-31 distinct-property count back to **~121–122** (pre-T9d).
- Evidenced-but-excluded count back to ~0: `available_listings` with `off_market_date IS NULL` + active-ish
  status + `on_market_date IS NULL` + `intake_artifact_path IS NOT NULL` should return to its pre-T9d level
  (the 135 evidenced listings are no longer excluded by a NULL-date gate — confirm the view no longer requires
  a non-null `on_market_date`).
- All 110 swept `on_market_date`s restored (0 rows where backup has a date but the live row is still NULL).
- `trg_listing_close_if_sold` still ENABLED; the `inferred_active` cron fix still in place.
- The asking-cap quartile @2026-03 returns to its pre-T9d value (the 7.09→8.04 "unstick" was the artifact of
  dropping 135 listings — it should revert).

## Boundaries
- This restores the pre-T9d state EXCEPT the kept `inferred_active` cron fix. No new logic. The real fix
  (provenance-first on-market-date recovery, keeping every evidenced deal) ships as a SEPARATE prompt
  (`CLAUDE_CODE_PROMPT_T9d2_provenance_first_currency.md`). Do not re-apply any exclusion gate.
