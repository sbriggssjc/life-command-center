# Fixes for the Broken Auto-Link / Cleanup Jobs

**Date:** 2026-05-21
**Companion to:** `RECONCILE_FUNCTION_AUDIT_2026-05-21.md`
**Status:** DRAFT patches for branch implementation + test. NOT applied — these are logic fixes to production cleanup functions; deploy after testing, on the affected DB.

The audit found these scheduled cleanup jobs failing silently. Root causes + concrete fixes below, in priority order.

---

## FIX 1 — dia `auto_link_and_refresh_property_queue` (CRITICAL: ~2,935 failures / 3 days, 100% of runs)

**Root cause:** `auto_link_orphan_properties_to_clinics` assigns a matched clinic's `medicare_id` to an orphan property, but nothing guards against that `medicare_id` already being held by another property → `properties_medicare_id_key` unique violation. Because the whole parent runs in one transaction, that one violation **aborts the entire tick — including the `REFRESH MATERIALIZED VIEW CONCURRENTLY` at the end** — so linking does nothing and the review-queue MV never refreshes. It has been failing every minute for days.

**Fix 1a — guard the assignment** (in `auto_link_orphan_properties_to_clinics`, the final SELECT/UPDATE that sets medicare_id):
```sql
-- only link a property to a clinic whose medicare_id is NOT already in use
... AND NOT EXISTS (
      SELECT 1 FROM public.properties p2
      WHERE p2.medicare_id = ap.medicare_id AND p2.property_id <> ap.property_id)
```

**Fix 1b — isolate per-row failures so one bad row can't kill the tick** (wrap the apply in a sub-block):
```sql
BEGIN
  PERFORM public.apply_property_link_outcome(rec.clinic_id, rec.the_property_id);
  v_links_inserted := v_links_inserted + 1;
EXCEPTION WHEN unique_violation THEN
  INSERT INTO public.lcc_health_alerts(alert_kind, detail, created_at)
  VALUES ('auto_link_medicare_conflict',
          format('clinic %s ↔ property %s skipped: medicare_id already in use',
                 rec.clinic_id, rec.the_property_id), now());
END;
```

**Fix 1c — decouple the MV refresh** so it always runs even if a linker errors (in `auto_link_and_refresh_property_queue`, wrap each linker call in its own BEGIN/EXCEPTION, then refresh unconditionally).

**Fix 1d — cadence + cleanup:** drop the cron from `* * * * *` to `*/15 * * * *` (or event-driven) per the scheduling review; and drop the duplicate no-arg overloads of `auto_link_exact_address_singletons()` / `auto_link_orphan_properties_to_clinics()` (two signatures exist — keep only the `p_run_id` versions to avoid the wrong one being called).

---

## FIX 2 — dia `dia_auto_merge_property_duplicates` (590 failures: statement timeout)

**Root cause:** fails on `statement timeout` while writing to an `ingestion_*` table — the per-merge logging inside `dia_merge_property` is the bottleneck at batch size 50 over the grown table; the hourly dedup never completes, so duplicates accumulate (why DQ-7 found so many).

**Fix:**
- Lower the cron batch (`dia_auto_merge_property_duplicates(20)` instead of 50) and/or raise the function's `statement_timeout` from 300s.
- Confirm the `ingestion_*` log table has an index on whatever the merge writes (the timeout was "inserting index tuple … in relation ingestion_*") — a bloated/unindexed log insert is the likely culprit; `REINDEX`/autovacuum check.
- **Surface the swallowed failures:** the function catches `WHEN OTHERS → v_failed+1; RAISE NOTICE`. Change to: when `v_failed > 0`, also `INSERT INTO lcc_health_alerts(...)` so systematic merge failures are visible (today they vanish into notices). Same change in `dia_auto_consolidate_listings`.

---

## FIX 3 — gov `lcc_data_hygiene_sweep` (FK violation on ownership_history)

**Root cause:** the bare-duplicate `DELETE FROM sales_transactions` already guards `NOT EXISTS (... ownership_history oh WHERE oh.sale_id = ...)`, but gov `ownership_history` references sales via **two** columns — `sale_id` **and** `matched_sale_id` — and the guard only checks `sale_id`. A bare sale referenced by `matched_sale_id` slips the guard → FK violation → the whole sweep aborts.

**Fix — extend the guard to every child FK referencing `sales_transactions.sale_id`:**
```sql
AND NOT EXISTS (SELECT 1 FROM public.ownership_history oh
                WHERE oh.sale_id = st.sale_id OR oh.matched_sale_id = st.sale_id)
-- and verify no other table FK-references sales_transactions(sale_id):
--   SELECT conrelid::regclass, conname FROM pg_constraint
--   WHERE confrelid='sales_transactions'::regclass AND contype='f';
```
(Belt-and-suspenders: wrap each delete step in its own BEGIN/EXCEPTION so one failing step doesn't abort the whole daily sweep.)

---

## FIX 4 — the alerting gap (meta: why nobody saw 2,935 failures)

`lcc-cron-health-check` (`lcc_check_cron_health`, hourly on each DB) is supposed to surface cron failures but never flagged the auto-link. Add a check that reads `cron.job_run_details`:
```sql
-- inside lcc_check_cron_health(): open an alert for any job failing repeatedly
INSERT INTO public.lcc_health_alerts(alert_kind, detail, created_at)
SELECT 'cron_job_failing',
       format('%s: %s failures in last 6h (last: %s)', j.jobname, cnt, last_msg), now()
FROM (
  SELECT d.jobid, count(*) cnt, left(max(d.return_message),200) last_msg
  FROM cron.job_run_details d
  WHERE d.status<>'succeeded' AND d.end_time > now() - interval '6 hours'
  GROUP BY d.jobid HAVING count(*) >= 5
) f JOIN cron.job j ON j.jobid=f.jobid
WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
                  WHERE a.alert_kind='cron_job_failing' AND a.detail LIKE j.jobname||'%'
                    AND a.resolved_at IS NULL);
```
These already flow to Teams via `lcc_notify_health_alerts_teams` (every 30 min). With this, a 100%-failing job is caught within the hour instead of in a manual audit.

---

## FIX 5 — general: stop swallowing exceptions silently

Across `dia_auto_merge_property_duplicates`, `dia_auto_consolidate_listings`, `dia_merge_property`: the `WHEN OTHERS` handlers increment a counter and `RAISE NOTICE` (invisible). Standardize: on caught exception, `RAISE WARNING` **and** insert an `lcc_health_alerts` row. Silent counters are how a broken job hides for months.

---

## Suggested deploy order
1. **Fix 1** (dia auto-link) — it's failing 1,440×/day and doing zero linking; biggest immediate win.
2. **Fix 4** (alerting) — so the next regression is caught in an hour.
3. **Fix 3** (gov hygiene FK) — one-line guard extension.
4. **Fix 2** (auto-merge timeout) — restores property dedup.
5. **Fix 5** (surface swallowed failures) — applied alongside 1/2.

*All read-only analysis; patches above are for branch implementation + test. Each is reversible (function replace) and additive (no data deleted).*
