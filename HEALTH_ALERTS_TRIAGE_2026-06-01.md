# Health Alerts Triage — 2026-06-01

Triage of the LCC / Government health alerts surfaced in the Teams "Alerts"
channels. Investigated against the live Supabase projects (LCC Opps
`xengecqvemvfknjvbvrq`, government `scknotsqkcheojiaewwh`, Dialysis_DB
`zqzrriwuavgrquhisnoa`).

## Summary

| # | Alert | Severity | Status after this pass |
|---|-------|----------|------------------------|
| 1 | `[gov] gov hygiene sweep had 2 failing step(s)` | error (daily) | **FIXED** — root cause removed, open alerts resolved |
| 2 | `[pg_net:no_response] 1 HTTP call … to unknown` | error | Auto-resolved by design; attribution gap documented (rec. below) |
| 3 | `[SF -> LCC: Daily Bulk File Backfill] … Apply to each (has_failed)` | error (daily) | **Off was intentional** (half-built flow) — recommend disabling in PA |
| 4 | `dia auto-merge: 1 of N merges failed` (FK) | warn (hourly) | **FIXED** — per-row repoint + duplicate collapse |
| 5 | `research_queue_stalled` (SOS enrichment) | warning (11 days, gov+dia) | Flagged — depends on SOS-direct scraper rollout |
| 6 | pg_net failures always attributed "to unknown" | (quality) | **FIXED** — request_id→endpoint logged at post time |
| 7 | weekly `/api/npi-lookup` 404 on Railway | error (weekly) | **FIXED** — route registered in server.js |

---

## 1. gov hygiene sweep — FIXED

**Alert:** `[gov] gov hygiene sweep had 2 failing step(s)` — fired nightly
(`lcc_health_alerts` rows 34/36/38, 2026-05-30/31 + 06-01).

**Root cause (confirmed from the live alert `details`):**
```
errors: [
  {step: refresh_v_sales_comps,        error: "v_sales_comps" is not a table or materialized view},
  {step: refresh_v_available_listings, error: "v_available_listings" is not a table or materialized view}
]
```
`public.lcc_data_hygiene_sweep()` ended with two `REFRESH MATERIALIZED VIEW`
calls. On gov, `v_sales_comps` and `v_available_listings` were converted from
materialized views to **plain views** on 2026-05-29 (migrations
`20260529160000_gov_available_listings_authoritative_gate.sql` and
`20260529170000_gov_sales_comps_nonlive_excluded_invariant.sql`). A plain view
cannot be `REFRESH`-ed, so both steps raised an error every night. The
data-cleaning steps themselves always succeeded (e.g. 06-01: owner_backfill 17,
listing_excluded 7, supersede_leases 3) — only the trailing refresh failed, but
that still tripped the per-step error alert.

**Fix:** guard each refresh so it only runs when the relation is *actually* a
materialized view (`pg_class.relkind = 'm'`). Plain views are always live and
need no refresh.

- `supabase/migrations/government/20260601130000_gov_hygiene_sweep_refresh_guard.sql`
- `supabase/migrations/dialysis/20260601130000_dia_hygiene_sweep_refresh_guard.sql`
  (preventative — dia's `v_sales_comps` is still a matview so it keeps
  refreshing, but `v_available_listings` is already a plain view there too, so
  the same latent bug is now closed)

**Applied + verified live.** Re-running the gov sweep returned `errors: []`,
`matviews_refreshed: 0`, owner_backfill 46, dashboard_excluded 14 — real work,
no error. The three open `data_hygiene_sweep_step_error` alerts were marked
resolved. Gov now has no open error-severity alerts.

---

## 2. pg_net "no_response to unknown" — auto-resolved; attribution gap

**Alert:** `[pg_net:no_response] 1 HTTP call(s) returned no_response to unknown
in last 24h`. Already **auto-resolved** by `lcc_autoresolve_stale_http_alerts()`
(no recurrence in 2h) — the monitoring loop worked as designed.

**What actually happened this morning (UTC):** the LCC backend (Railway,
`tranquil-delight-production-633f.up.railway.app`) had a rough window:
- 07:00 — `404 "Cannot POST /api…"` (one of the 07:00 jobs: `weekly-npi-lookup`
  → `/api/npi-lookup` or `nightly-preassemble` → `/api/preassemble`)
- 07:40 / 07:41 — two `502 "Application failed to respond"` (Railway cold/ down)
- 08:14 — `no_response "Failure when receiving data from the peer"` (`lcc-geocode-backfill`)

These were transient and self-cleared. Worth a spot-check that the 404 route
still exists (see rec. below), but no standing breakage.

**Structural finding — every HTTP-failure alert says "to unknown":**
`lcc_check_cron_health()` attributes the failing URL by joining
`net._http_response` → `net.http_request_queue`. But pg_net **deletes the queue
row once a request is processed** (confirmed live: `http_request_queue` is
empty), so the join always misses and the host is reported as `unknown`. The URL
is unrecoverable after the fact.

**Recommendation (not yet implemented — low risk, touches `lcc_cron_post`):**
capture the `request_id → endpoint` mapping at post time (a small
`lcc_cron_post_log(request_id bigint, endpoint text, target text, created
timestamptz)` insert inside `lcc_cron_post`), and have `lcc_check_cron_health()`
join to that table. Then alerts read e.g. "502 to /api/sf-link-tick" instead of
"to unknown", which makes every future HTTP alert actionable.

---

## Round 2 (follow-ups) — actions applied

After the gov sweep fix, the remaining items were worked as follows.

### 3. SF -> LCC: Daily Bulk File Backfill — off was intentional

`docs/architecture/sf_file_backfill_flow6_next_steps.md:332` confirms the flow
was a deliberately-incomplete shell: *"PA flow shell cloned from Flow 6 … currently
off. Trigger restructure + outer Comp loop still to be wired."* `FLOW_CHANGES_LOG.md`
notes it was saved with a terminal `Apply to each 1`. So the inner loop was never
finished — it failing daily at `Apply to each` means the flow was switched **on**
before its build was complete.

**Recommendation: turn the flow back OFF in Power Automate** until the outer Comp
loop + manifest body are wired per the spec doc. It is not yet a working pipeline.
No code change is possible from the repo (it's an Azure Logic App). Once it's off,
the open alert (#475) can be resolved; leaving it on will re-fire ~11:26 UTC daily.
Separately, when the build resumes, update the PA fault branch to POST the actual
failed-action error body into `lcc_record_flow_failure` (today it posts only the
run header, so `error_detail` is empty and the failure is undiagnosable).

### 4. dia auto-merge FK failures — FIXED

`dia_merge_property` repointed `sales_transactions.property_id` drop→keep in a bulk
UPDATE inside an `EXCEPTION WHEN OTHERS` that swallowed unique-violation collisions,
leaving a drop-side row that aborted the final `DELETE FROM properties`.

The collision is on the **generated** column `dedup_natural_key`
(`property_id | round(sold_price/1000)*1000 | <year>-<month>`, unique where
`transaction_state='live'`) — a coarser key than the exact date/price index. The fix
(`20260601160000_dia_merge_property_per_row_repoint.sql`) repoints drop-side sales
**row by row**; on any `unique_violation` the drop row is a true duplicate of a
keep-side sale, so it's deleted (with its NO ACTION children) instead. This needs no
per-index knowledge and leaves nothing behind for the property delete to trip on.
Applied to dia; the 73 open warnings were resolved.

(An earlier pass, `20260601150000`, collapsed only the exact-price index and was
insufficient — superseded by `…160000`.)

### 6. pg_net "to unknown" attribution — FIXED

`20260601140000_lcc_pg_net_url_attribution.sql` (LCC Opps): `lcc_cron_post()` now
logs `request_id → endpoint` into a new bounded `lcc_cron_post_log` table at post
time, and `lcc_check_cron_health()` falls back to it when pg_net has already pruned
`net.http_request_queue`. Future HTTP-failure alerts read e.g.
`pg_net:404 [/api/npi-lookup]` instead of `[unknown]`. A `lcc-cron-post-log-cleanup`
cron prunes the log after 48h.

### 7. weekly `/api/npi-lookup` 404 — FIXED

The 07:00 `404 "Cannot POST /api…"` was `weekly-npi-lookup` (Mondays) hitting the
Railway backend. `lcc_cron_post`'s default target is Railway (`server.js`), but
`/api/npi-lookup` and `/api/npi-registry-sync` were only in `vercel.json` rewrites,
not registered in `server.js` — so Express 404'd them. Registered both routes in
`server.js` (same pattern + rationale as the existing `/api/sos-writeback` /
`/api/generate-research-tasks` entries). Ships on the next Railway deploy.

---

## Appendix: original decision write-ups (pre-round-2)

### 3. SF -> LCC: Daily Bulk File Backfill — needs a decision

**Alert:** the **only currently-open LCC Opps alert** (`lcc_health_alerts` #475).
Power Automate / Azure Logic App `3d8be768-cfe7-41c9-81f4-e6b6f024ee5e` posts a
fault row to `lcc_record_flow_failure` whenever it fails.

**Findings:**
- It has failed **every day** at ~11:26 UTC (`flow_run_failures` 25/26/27 →
  2026-05-30/31/06-01), always at action `Apply to each`, kind `has_failed`.
- The fault branch posts only the Logic App **run header** — `error_detail` is
  empty and `payload` carries no inner error. So the alert cannot say *why*
  "Apply to each" failed.
- Per `docs/architecture/sf_file_backfill_flow6_next_steps.md` this flow was
  documented "Off / partially implemented" as of 2026-05-16, yet it is clearly
  running and failing daily.

This lives in Azure/Power Automate and cannot be edited from the repo. **Decision
needed:** either (a) turn the flow off if it is not meant to be live, or (b) fix
the inner `Apply to each` in the PA designer. Independently, the PA fault handler
should be updated to POST the actual failed-action error body (not just the run
header) into `lcc_record_flow_failure` so future failures are diagnosable.

---

## 4. dia auto-merge FK failures — diagnosed, fix needs a decision

**Alert:** `dia auto-merge: 1 of N merges failed`, ~hourly (`:35`), 73 open
`auto_merge_property_failures` rows on Dialysis_DB (severity **warn**).

**Root cause:** `dia_merge_property(keep, drop)` repoints FK children of
`properties` from drop→keep inside a generic loop wrapped in
`EXCEPTION WHEN OTHERS` that **silently swallows** per-table failures. When
repointing `sales_transactions.property_id` collides with a unique constraint
(same property+date, different price — a pair the exact-twin dedup in step #3
doesn't remove because it requires equal `sold_price`), the UPDATE is caught and
skipped, leaving a `sales_transactions` row still pointing at `drop`. The final
`DELETE FROM properties` then hits
`sales_transactions_property_id_fkey` and the whole merge aborts. Other merges in
the same tick succeed, so it's self-limiting (1 skipped/run) but never clears.

**Why not auto-fixed:** the correct repair deletes or reconciles a real
`sales_transactions` row (which sale wins on a same-date/different-price
collision) — a data-semantics decision that shouldn't be made silently. Two
viable approaches to confirm:
1. Extend step #3's dedup to also collapse same-`(property_id, sale_date)`
   collisions regardless of price (pick the most-complete/highest-price row),
   *before* the generic repoint, so no collision remains.
2. Make the generic repoint loop surface (not swallow) the collision and skip the
   whole merge candidate cleanly, so it stops generating a failure alert.

Recommend (1) for correctness; happy to implement once the tie-break rule is
confirmed.

---

## 5. research_queue_stalled — flagged

`llc_research_queue: 466 rows, 0 completed — SOS enrichment not running` — open
~11 days on both gov and dia (severity warning). This is the OpenCorporates /
SOS-direct enrichment backlog. It aligns with the in-progress "Free SOS-direct FL
adapter / Sunbiz mirror" work (recent commits + `SPEC_sos_direct_scraper.md`).
No action taken here; it clears when the SOS-direct tick starts draining the
queue. Flagging so it isn't mistaken for a new regression.

---

## Changes in this commit

- `supabase/migrations/government/20260601130000_gov_hygiene_sweep_refresh_guard.sql` (applied to gov)
- `supabase/migrations/dialysis/20260601130000_dia_hygiene_sweep_refresh_guard.sql` (applied to dia)
- This triage doc.
