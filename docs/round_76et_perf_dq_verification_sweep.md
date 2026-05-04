# Round 76et — Perf dashboard fixes + data-quality + verification audit-honesty sweep

## Scope

Started 2026-04-29 from a perf-dashboard review. Grew into a full data-quality
+ verification-loop sweep across LCC ops, dia, and gov DBs over 16 PRs (#491
through #531). Cumulative diff: 70 files, +3,690 / −637. Tests went from
108 (15 failing) to 137 (all passing). Lint: 74 errors → 0.

## Migrations to apply

The branch shipped 13 SQL migrations. Apply per database; all are idempotent
(re-running is a no-op).

### LCC ops DB

| Order | File | What |
|---|---|---|
| 1 | `supabase/migrations/20260429320000_inbox_research_view_sort_indexes.sql` | Drops `ORDER BY` from `v_inbox_triage` / `v_research_queue` / `v_entity_timeline`; adds 3 partial composite indexes covering WHERE+ORDER. |
| 2 | `supabase/migrations/20260429410000_lcc_v_data_quality_issues.sql` | Multi-tenant DQ view; 8 issue kinds (stuck_sync_job, unresolved_sync_error, stuck_research, stale_open_action, unassigned_action, orphan_inbox_entity, orphan_action_entity, escalation_overdue). |

### dia DB

| Order | File | What |
|---|---|---|
| 1 | `supabase/migrations/dialysis/20260429500000_dia_v_data_quality_issues_add_verification_drift.sql` | Adds `listing_active_no_verification_due` issue kind to existing dia DQ view. |
| 2 | `supabase/migrations/dialysis/20260429600000_dia_drop_unused_verification_views.sql` | Drops `v_listings_due_for_verification` + `v_listing_verification_detail` (both had zero consumers). |
| 3 | `supabase/migrations/dialysis/20260429700000_dia_lcc_record_listing_check_add_inferred_active.sql` | Adds `inferred_active` to `lvh_check_result_check`; updates RPC's CASE branches so `inferred_active` is a narrow timer advance (no `consecutive_check_failures` reset, no `is_active` flip). |
| 4 | `supabase/migrations/dialysis/20260429800000_dia_backfill_inferred_active_audit_history.sql` | **One-shot UPDATE.** Relabels historical `auto_scrape` rows from `still_available` → `inferred_active`. Emits `[dia/76et-D] relabeled N rows` NOTICE. |
| 5 | `supabase/migrations/dialysis/20260429900000_dia_v_listing_verification_summary_breakout_inferred.sql` | Adds `cron_timer_advances_*` and `evidence_verifications_*` columns to `v_listing_verification_summary`. |

### gov DB

| Order | File | What |
|---|---|---|
| 1 | `supabase/migrations/government/20260429400000_gov_v_data_quality_issues_and_listing_close_backfill.sql` | New gov DQ view + **one-shot UPDATE** that closes orphaned Active listings using the now-correct `pickClosestListing` rule. Emits `[gov-listing-close-backfill] closed N listings` NOTICE. |
| 2 | `supabase/migrations/government/20260429500000_gov_v_data_quality_issues_add_verification_drift.sql` | Adds `listing_active_no_verification_due` issue kind. |
| 3 | `supabase/migrations/government/20260429600000_gov_drop_unused_verification_views.sql` | Drops the same two unused views from gov. |
| 4 | `supabase/migrations/government/20260429700000_gov_lcc_record_listing_check_add_inferred_active.sql` | gov mirror of the dia RPC update. |
| 5 | `supabase/migrations/government/20260429800000_gov_backfill_inferred_active_audit_history.sql` | **One-shot UPDATE.** gov mirror. Emits `[gov/76et-D] relabeled N rows`. |
| 6 | `supabase/migrations/government/20260429900000_gov_v_listing_verification_summary_breakout_inferred.sql` | gov mirror of the summary view extension. |

### Three migrations mutate data

- **`gov/20260429400000`** closes orphaned Active gov listings. The orphan
  count is the number of historical sales that hit the broken
  `pickClosestListing` path.
- **`dia/20260429800000`** + **`gov/20260429800000`** relabel historical
  cron rows in `listing_verification_history`.

All three emit `RAISE NOTICE` with the row count on deploy. Re-running is
a no-op (the WHERE clause excludes already-processed rows).

## Verification queries

After migrations are applied, run these per database to confirm.

### LCC ops DB

```sql
-- Both DQ views exist
SELECT count(*) FROM information_schema.views
 WHERE table_schema='public'
   AND table_name IN ('v_data_quality_issues','v_data_quality_summary');
-- Expect 2.

-- Indexes added
SELECT indexname FROM pg_indexes
 WHERE schemaname='public'
   AND indexname IN (
     'idx_inbox_ws_status_received',
     'idx_research_ws_status_priority_created',
     'idx_activities_entity_occurred'
   );
-- Expect 3.
```

### dia DB

```sql
-- Backfill effect (run AFTER 20260429800000)
SELECT count(*) FROM listing_verification_history
 WHERE method='auto_scrape' AND check_result='still_available';
-- Expect 0.

SELECT count(*) FROM listing_verification_history
 WHERE method='auto_scrape' AND check_result='inferred_active';
-- Should match the historical cron-tick count.

-- Summary view extension
SELECT cron_timer_advances_7d, evidence_verifications_7d
  FROM v_listing_verification_summary;
-- Expect non-null integers (sum equals verifications_last_7d).

-- Dropped views
SELECT count(*) FROM information_schema.views
 WHERE table_schema='public'
   AND table_name IN ('v_listings_due_for_verification','v_listing_verification_detail');
-- Expect 0.
```

### gov DB

```sql
-- Listing-close backfill effect (run AFTER 20260429400000)
SELECT count(*) FROM available_listings
 WHERE listing_status='Active'
   AND EXISTS (
     SELECT 1 FROM sales_transactions st
      WHERE st.property_id = available_listings.property_id
        AND st.sale_date IS NOT NULL
        AND ABS(st.sale_date - available_listings.listing_date) <= 1096
   );
-- Expect 0 (or close to it — only listings outside the 3-year window
-- should remain Active despite a sale).

-- DQ view available
SELECT issue_kind, issue_count FROM v_data_quality_summary;

-- Audit-label backfill effect
SELECT count(*) FROM listing_verification_history
 WHERE method='auto_scrape' AND check_result='still_available';
-- Expect 0.

-- Summary view extension
SELECT cron_timer_advances_7d, evidence_verifications_7d
  FROM v_listing_verification_summary;
```

## Operational signals to watch

After deploy, the perf dashboard and Vercel function logs should show:

- **`render:*` rows in Performance Target Compliance now have real
  numbers** (not `--`). Pre-fix the `_perf` beacon discarded the body.
- **`view=work_counts` p95 inside the 150ms target.** Pre-fix it was
  158ms (warning) due to the `count=exact` second trip on every read.
- **Fewer slow alerts on `view=my_work` / `view=inbox`.** Same root
  cause; the `count=estimated` switch removed the dominant cost.
- **`apply-change` max latency well under 6s.** `fetchWithTimeout`
  caps the gov/dia mutation; timeout cases now return 504 with
  `pending_review` and `status=timeout` in the perf metadata.
- **`[gov-listing-close-backfill]`, `[dia/76et-D]`, `[gov/76et-D]`
  NOTICE lines on the first deploy** showing migration row counts.
- **`[sync/rcm-backfill] SF match attempt failed`** logs become visible.
  These were silent before; if you see lots, it's a real signal that
  the SF view or auth token degraded.
- **Verification cards now show `evidence/7d · cron-only/7d`** breakout
  on dia (On-Market) and gov (Available) Sales sub-tabs.
- **"Recent Verifications (7d)" panel renders below the verification
  card** on dia + gov with All / Evidence / Cron-only filter buttons.
- **Three new DQ panels on the Ops tab**: Domain DQ (gov), Ops DQ
  (multi-tenant LCC ops), and the existing Domain DQ (dia).

## Themes (high level)

1. **Original perf review** — beacon persistence, awaited audit writes,
   `countMode` opt-in on `opsQuery`, `fetchWithTimeout` for apply-change,
   parallelized `handleHealth`, logged the swallowed RCM→SF match catch.
2. **Test harness back to green** — fixed 15 pre-existing failures so CI
   can gate on tests.
3. **Round-2 perf follow-ups** — stack traces in error handler, view
   sort indexes, v1 endpoint countMode sweep, more awaited audit
   writes, Treasury fetch logging, lint config Node 18+ globals.
4. **`pickClosestListing` + dead-code cleanup** — the silent gov
   listing-close bug + 2 other lint-flagged real bugs.
5. **Data-quality views + UI panels** — gov + LCC ops DQ views + the
   Ops tab panels that surface them.
6. **Verification cron audit-honesty** — cron now matches the JS
   `pickClosestListing` rule, sees NULL `verification_due_at`, honors
   `exclude_from_listing_metrics`, drops dead views, uses new
   `inferred_active` check_result, backfills history, surfaces the
   evidence-vs-cron breakout in the summary view + cards.
7. **Gov verification dashboard parity + drill-down** — gov got the
   summary card dia already had, plus a recent-verifications drill-
   down panel on both sides, plus `getRows()` to bridge the
   diaQuery / govQuery shape mismatch for new consumers.

## Items still open (not in this round)

In rough priority order:

1. `listing_id` deep-link in the recent verifications drill-down rows.
2. Replace `detail.js`'s local `extract()` with `getRows()`.
3. PostgREST proxy `countMode` opt-out in `dia-query.js` / `gov-query.js`.
4. Provenance instrumentation for CMS sync, county records, manual edits, Salesforce.
5. Sidebar pipeline Phase 2.2 instrumentation (perf metrics for ingestion latency).
6. Wire `verification_due_at` for new gov listings (audited in DQ view but no proactive backfill yet).
7. `v_listing_verification_anomalies` for method × check_result mismatches.
8. Convert the remaining ~200 `diaQuery` / `govQuery` call sites to use `getRows()`.

## PR list (all merged into main)

| PR | Commit | Theme |
|---|---|---|
| #491 | `7b98685` | Persist _perf beacon |
| #493 | `a3a6300` | Await perf logging + audit writes |
| #497 | `dbe44f2` | countMode on opsQuery |
| #499 | `ef276d9` | fetchWithTimeout + drop work_counts fallback |
| #501 | `577c8cd` | Parallelize handleHealth + log SF match |
| #506 | `582fb05` | Test suite back to green |
| #511 | `b102f59` | Round-2 perf follow-ups |
| #514 | `16b5226` | pickClosestListing + dead code |
| #516 | `da81179` | Gov + LCC ops DQ panels (with #515 for migrations) |
| #520 | `452b4af` | NULL verification_due_at |
| #521 | `5ecb1fa` | Drop unused verification views |
| #523 | `0b55d47` | Gov verification card |
| #526 | `f76d601` | Backfill audit history |
| #528 | `2f7e09f` | Evidence vs cron-only breakout |
| #529 | `7587849` | Drill-down panel |
| #531 | `13e28cc` | getRows() helper |
