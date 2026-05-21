# Reconcile / Clean / Dedup Function Audit — Schedule, Gaps, Silent Failures

**Date:** 2026-05-21
**Method:** inventoried every `auto_*/merge/dedup/resolve/reconcile/consolidate/hygiene/sweep/cleanup` function across dia/gov/LCC, cross-referenced to `cron.job`, and read `cron.job_run_details` for the last 3 days. This is the part of the audit you asked for: are the cleanup functions scheduled at sane intervals, and are there logical gaps or silent failures?

## Headline: the data quality this audit cleaned up by hand had been accumulating because the automated cleanup jobs are silently failing.

---

## 1. Silent failures found in production cron history (last 3 days)

| DB | Job | Failures | Cause | Severity |
|----|-----|----------|-------|----------|
| **dia** | `auto-link-and-refresh-property-queue` (every minute) | **2,935** (≈100% of runs) | `duplicate key value violates unique constraint "properties_medicare_id_key"` | **CRITICAL** |
| **dia** | `dia-auto-merge-property-duplicates` (hourly) | **590** | `statement timeout` (writing to `ingestion_*`) | HIGH |
| **dia** | `dia-data-hygiene-sweep` (daily) | 2 | `statement timeout` | MED |
| **gov** | `gov-data-hygiene-sweep` (daily) | 2 | FK violation — deleting `sales_transactions` still referenced by `ownership_history.sale_id` | MED |
| **LCC** | `dia-link-provenance-replay`, `refresh-work-counts`, `lcc-retry-stranded-extractions`, `lcc-merge-log-reconcile`, etc. | 2–5 each | `job startup timeout` | (symptom) |

### 1a. dia auto-link is 100% broken (and has been for days)
The **every-minute** `auto_link_and_refresh_property_queue` aborts on **every run** with a `properties_medicare_id_key` unique violation — one of its linkers (`auto_link_orphan_properties_to_clinics` / `auto_link_exact_address_singletons`) tries to assign a `medicare_id` already held by another property, and because the whole function is one transaction, the abort also skips the `mv_clinic_property_link_review_queue` refresh. **Net effect:** orphan→clinic linking has been doing nothing for days, the link-review MV is stale, and 1,440 failed runs/day pile up in cron history. This is a *logical gap* (no guard against an already-used medicare_id) producing a *silent failure* (only visible in `cron.job_run_details`). It is also the every-minute cadence flagged in the scheduling review — so it's both over-scheduled *and* entirely failing.

### 1b. dia auto-merge-duplicates times out
`dia_auto_merge_property_duplicates` (the sound, operator-aware deduper) has `statement_timeout=300s` but is failing on timeout — likely the audit/`ingestion_*` write or the normalized-address grouping over the now-larger table. **So the hourly property-dedup that should prevent the duplicate-address buildup hasn't been completing** — which is why the manual DQ-7 pass found so many duplicates to merge.

### 1c. gov hygiene sweep has a FK-ordering bug
`gov-data-hygiene-sweep` tries to delete `sales_transactions` rows that `ownership_history.sale_id` still references → FK violation → whole sweep aborts. Logical gap: it must null/repoint or delete `ownership_history` children first (or use `ON DELETE` semantics).

### 1d. LCC failures are outage symptoms, not logic bugs
All LCC failures are `job startup timeout`, clustered at the two connection-exhaustion windows (2026-05-20 23:30 and today 15:18–15:32). They're symptoms of the connection saturation already diagnosed — they should clear now the DB is restarted; the durable fix is the pooler + cron de-densification (intake addendum §1).

---

## 2. The alerting gap (meta-finding)

Each DB runs `lcc-cron-health-check` hourly, which is *supposed* to surface cron failures into `lcc_health_alerts`. Yet `auto-link` failed **2,935 times** without anyone acting. Either the health check doesn't read `cron.job_run_details` failures (only pg_net non-2xx), or the alerts land in `lcc_health_alerts` but aren't routed anywhere a human sees. **Recommend:** verify `lcc_check_cron_health` flags repeated `cron.job_run_details` failures, and route high-severity ones to the Teams push that already exists (`lcc_notify_health_alerts_teams`).

---

## 3. The exception-swallowing pattern (latent silent failures)

`dia_auto_merge_property_duplicates`, `dia_auto_consolidate_listings`, and `dia_merge_property` catch `WHEN OTHERS` and increment a `failed` counter with only `RAISE NOTICE`. Even when the function "succeeds," per-row merge failures are invisible (notices aren't captured). **Recommend:** on non-zero `failed`, write an `lcc_health_alerts` row (or at least `RAISE WARNING`) so systematic merge failures surface.

---

## 4. Built-but-unscheduled functions (verify intent)

Several cleanup functions exist but aren't in `cron.job`: `dia_auto_stale_listings`, `dia_consolidate_property_listings`, `llc_research_queue_auto_skip`, `auto_stub_no_candidate_clinics`. Some are helpers called by scheduled parents (fine); others may be orphaned (a gap — built then never wired). Each needs a one-line confirm: "is this called by a scheduled function or a trigger, or is it dead?" (`auto_supersede_expired_leases` and the `trg_*` ones are triggers — correctly event-driven, not gaps.)

---

## 5. Recommended priority

1. **Fix dia `auto_link_*` medicare_id guard** — it's failing 1,440×/day and doing zero linking. Add `WHERE NOT EXISTS (a property already holding that medicare_id)` (or `ON CONFLICT DO NOTHING`), and per the scheduling review drop the cadence to 5–15 min/event-driven.
2. **Fix dia `dia_auto_merge_property_duplicates` timeout** — investigate the `ingestion_*` write; ensure the dedup completes so duplicates stop accumulating.
3. **Fix gov hygiene FK ordering** — handle `ownership_history` children before deleting sales.
4. **Close the alerting gap** (§2) so the next silent failure is seen in hours, not found in a manual audit.
5. **Surface swallowed merge failures** (§3).
6. **Confirm/retire unscheduled functions** (§4).

*Read-only audit. No functions or schedules were changed. Items 1–6 are code/migration fixes for branch implementation + testing.*
