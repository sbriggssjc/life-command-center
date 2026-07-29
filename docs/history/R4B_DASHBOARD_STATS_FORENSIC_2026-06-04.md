# R4-B — Dashboard stat correctness + data quality (2026-06-04)

Round-4 live audit found domain dashboards asserting numbers that were
artifacts of query caps, join-cardinality explosions, or a
semantically-wrong field. The rule enforced here: **the app must never
present a LIMIT (or a duplicated/holdover value) as a total.** Headline
totals/averages now come from server-side aggregates (materialized views /
summary views), not from `.length`/`reduce` over page-limited arrays.

## What shipped

### 1. Gov overview — true totals (server-side)
`mv_gov_overview_stats` (gov DB `scknotsqkcheojiaewwh`) rebuilt to carry every
headline number as a full-table aggregate, and `gov.js` rewired to read them.

| Tile | Was (capped/derived) | Now (MV, full table) |
|---|---|---|
| All-Time Comps | `sales.length` = **1,000** (fetch cap) | `total_sales` = **11,911** |
| All-Time Volume / Avg | sum over loaded slice | $83.7B priced / **$18.8M** avg (4,450 priced) |
| TTM Transactions/Volume | over loaded array | `sales_ttm_count` = **1,172** |
| Total Leads | `leads.length` = **1,000+** | `total_leads` = **11,537** |
| Pipeline Value / Avg Lead | sum/avg over top-1,000 → **$28M/lead** | $58.8B over 7,677 valued / **$7.66M** avg |
| GSA Events YTD | 500 (cap) | `gsa_events_ytd` = **52,828** of 261,254 |
| GSA Total Rent / leases | sum of 500 snapshots | `gsa_leases` = **7,495** leases / **$5.79B** |
| FRPP properties | 1,000–5,000 (cap) | `frpp_total` = **21,947** |

Cap-rate quartiles stay row-level (a percentile can't be cheaply expressed in
the MV) and are now explicitly labeled "sample of loaded comps".

The pipeline **tab** KPIs (`renderGovPipeline`) were also switched to the MV
totals; the top-1,000 working set is still used only for the table/charts.

### 2. Lease-expiration forensic (gov)
**Symptom:** "EXPIRING < 1 YEAR 7,722 = 72.3% of portfolio", only 4 expired.

**Root cause (NOT stale data / NOT a broken recompute):** the chart bucketed off
`firm_term_remaining`, which is correctly **clamped to 0** the day the *firm*
term elapses. A 5-yr firm term inside a 15-yr lease hits 0 in year 5 even though
the lease runs another decade. 7,320 seasoned `excel_master` leases (avg
`firm_term_remaining` ≈ 0.017, avg `firm_term_years` ≈ 6.5) pile into the 0–1yr
firm bucket that way. `updated_at` is fresh (2026-06-01→04) — the daily
recompute *is* running; the values are right for *firm* term, wrong as a proxy
for *lease expiration*.

**Cohort:** of the 7,718 "0–1yr" rows, 7,320 are `excel_master`, 370
`costar_sidebar`, rest backfills. **4,550 of the excel_master rows have
`lease_expiration` already in the past** (some a decade old) — genuinely
stale/holdover leases that were never aged out, distinct from "expiring soon".

**Fix:** bucket "Lease Expiration Risk" off the **actual `lease_expiration`
date** (the correct field) and surface the expired/holdover cohort honestly as
its own tile — not a cosmetic re-bucket, a switch to the right field + an honest
expired bucket. Defensible distribution now:

| bucket | count |
|---|---|
| Expired / holdover | **4,798** (4,002 expired >1yr — stale) |
| < 6 months | 407 |
| 6 – 12 months | 386 (so **< 1 yr = 793**, not 7,722) |
| 1 – 2 years | 692 |
| 2 – 5 years | 1,434 |
| 5+ years | 2,858 |

> **Data-quality follow-up (backlog):** the 4,002 leases expired >1yr ago are a
> real GSA/excel refresh gap (lease likely renewed; `properties` row never
> updated). Surfaced now as "Expired / holdover" with a stale count so it's
> visible; aging/renewal reconciliation is a separate pipeline task.

### 3. Recent closed sales duplicated 10× (dialysis)
`v_sjc_deal_book` selected **every** import snapshot from `sf_listing_staging`
(13,940 rows → only **161** distinct `sf_listing_id`), so one deal surfaced
37–205×. Fixed at the source: `DISTINCT ON (sf_listing_id)` keeping the most
recently modified snapshot. Recent-closed-sales now shows 10 distinct deals;
`v_sjc_deal_book_by_year` self-corrects.

**2024 finding:** the "2024 = 37 vs 2023 = 781 vs 2025 = 240" pattern was
**entirely a duplication artifact** (each deal counted dozens of times). Deduped
reality: **2023 = 6, 2024 = 1, 2025 = 3** closed commercial deals. 2024 is a
genuinely low year (1 deal), **not** a sync gap.

### 4. Stuck-forever widgets (dialysis)
- **Clinic Financial Estimates** — was paging ~36K `is_latest` rows (37 edge-fn
  round trips) to compute 5 averages → effectively never resolved. Replaced with
  server-side `v_clinic_financial_overview` (ONE row). Renders **8,511 clinics /
  $49.9B industry rev / $5.87M avg** instantly. Error/empty now render an
  explicit state, not a spinner.
- **LLC Research Queue** — bare `fetch` with no timeout could hang forever. Added
  a 20s `AbortController`; on timeout/non-200 it shows "unavailable — <reason>".
- **Clinical Metrics** (8,505 rows / 9 pages) and **Listings Needing
  Confirmation** (504 rows / 1 page) already have catch→error states and are
  small; left as-is.

### 5. Agency-name pollution (gov)
`POTOMAC / METROPOLITAN / TRIANGLE / DC SERVICES DIVISION` are USPS facility
*division* labels, not leasing agencies. Excluded from agency rollups (and
`agencies_tracked`) via `!~* 'SERVICES DIVISION$'` in the MV and the matching
client-side path. The single legit "...Services Division of Contra Costa County"
ends differently and is unaffected. (3,712 Unknown-agency / $1,225M rows left
for enrichment, per the audit.)

### Not a bug — verified
- Team Pulse "RESEARCH 3000": genuine `count(*)` of **3,021** queued
  `research_tasks` (no cap). The "3000" was display rounding.

## Migrations (idempotent; ordering)
Data-layer changes are live immediately (views read per request). Frontend
(`gov.js` / `dialysis.js`) ships on the next Railway redeploy of merged `main`.
Apply order is independent — the new MV/views are additive and the frontend
falls back to the loaded arrays when a field is absent.

- `supabase/migrations/government/20260604140000_gov_overview_stats_true_totals.sql`
  — DROP + CREATE `mv_gov_overview_stats` (no `CREATE OR REPLACE` for matviews),
  recreate the `computed_at` index, `REFRESH`. No dependent objects. The daily
  refresh cron is name-stable and non-concurrent, so it keeps working.
- `supabase/migrations/dialysis/20260604140000_dia_sjc_deal_book_dedupe.sql`
  — `CREATE OR REPLACE VIEW v_sjc_deal_book` (column list unchanged → no 42P16).
- `supabase/migrations/dialysis/20260604141000_dia_clinic_financial_overview.sql`
  — `CREATE OR REPLACE VIEW v_clinic_financial_overview`.

All three applied live to their projects on 2026-06-04 and verified.

## Verify
- `node --check gov.js && node --check dialysis.js` → OK
- `npx eslint gov.js dialysis.js` → exit 0
- `ls api/*.js | wc -l` → 12 (unchanged; no new functions)
