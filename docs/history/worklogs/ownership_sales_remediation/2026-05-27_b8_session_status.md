# Ownership & Sales Remediation — 2026-05-27 Session Status (B8)

Picks up after PR #950 (A6a ownership_history closure + auto-close trigger, merged + deployed). Focus this round: **B8 — Data Health dashboard tile**.

## What landed this session

### New tile — Domain Health Summary

`ops.js` Data Quality page now leads with a side-by-side dia / gov tile that surfaces 9 metrics, each with today's value AND a 30-day sparkline:

```
┌─────────────────────────────┬──────────────┬──────────────┐
│ Metric                      │ Dialysis     │ Government   │
├─────────────────────────────┼──────────────┼──────────────┤
│ Live sales                  │ value + spark│ value + spark│
│ Sales completeness          │ avg / median │ avg / median │
│ Needs-review sales          │ value + spark│ value + spark│
│ Live dupe groups            │ value + spark│ value + spark│
│ Property → recorded_owner   │ pct  + spark │ pct  + spark │
│ Ownership history (active)  │ value + spark│ value + spark│
│ Recorded owners             │ count        │ count        │
│ True owners                 │ count        │ count        │
│ SF-link backfill (A7)       │ linked/total │ linked/total │
└─────────────────────────────┴──────────────┴──────────────┘
```

This makes the back-end work from the last 7 rounds (F1-F4, C1-C2-C4, B-series, A1-A7, **A6a auto-close trigger**) visible to the operator. Previously everything was SQL-queryable but not surfaced.

### Implementation details

- New function `renderDomainHealthSummary()` in `ops.js` (~190 lines including helpers)
- Anchor div `<div id="domainHealthSummary">` placed at the top of `renderDataQualityPage()`, before the existing `metrics-grid`
- Hydrates asynchronously via `Promise.all` of 12 parallel queries (6 per domain)
- Inline SVG sparkline helper `_opsSparkline(series, opts)` — green/red/grey tone based on first→last delta; renders "no trend" badge when fewer than 2 data points exist
- Trend extraction helper `_opsTrendSeries(rows, view, metricKey)` pulls a specific metric out of `v_data_health_trend.payload` JSON
- Handles `diaQuery` vs `govQuery` return-shape difference (`Array` vs `{data: Array}`) via local `unwrap()`

### Edge Function allowlist extension

The `supabase/functions/data-query/index.ts` allowlist was missing every health view. Added 8 view names to **both** `GOV_READ_TABLES` and `DIA_READ_TABLES`:

```
v_data_health_sales
v_data_health_ownership
v_data_health_entities
v_sales_completeness_summary
v_sales_completeness
v_data_health_trend
v_sf_link_queue_summary          (NEW — added this round)
v_sf_link_review_queue           (from A7 — was unallowlisted)
```

### New SQL artifact — `v_sf_link_queue_summary`

Pulling all 27K+ rows of `sf_link_research_queue` on every page-load would be wasteful. Added an aggregation view that returns one row per status (queued / in_progress / linked / needs_review / no_match / failed / unsupported). Applied via MCP migration on both domains; repo migrations:

- `supabase/migrations/dialysis/20260527140000_dia_v_sf_link_queue_summary_b8.sql`
- `supabase/migrations/government/20260527140000_gov_v_sf_link_queue_summary_b8.sql`

## Deploy steps

Two deploys are needed once this PR merges:

1. **Vercel** — automatic on merge; gives the operator the new tile (but it will show "Read access denied" until step 2 lands).
2. **Supabase Edge Function** — manual from a workstation with the Supabase CLI:

   ```bash
   cd life-command-center
   supabase functions deploy data-query --project-ref zqzrriwuavgrquhisnoa
   ```

   Project-ref is the **Dialysis_DB** project per CLAUDE.md ("the LIVE data-query Edge Function is on the Dialysis_DB project, NOT on LCC Opps") — deploying to the wrong project silently no-ops. After deploy, the allowlist additions take effect on the next request.

Until the Edge Function redeploys, the tile will render but show `[]` for every cell. The cron infrastructure (A7 SF-link tick, daily snapshots feeding `v_data_health_trend`) keeps working — only the UI surface is gated.

## Plan status

- ✅ **DONE** (23, ↑1): F1-F4, C1, C2, C3 (N/A), C4, C6, **B8 (this round)**, B1, B2, B4, B5, B7, A1, A2, A3, A4 (partial), A5, A6, A7
- ⬜ **TODO** (9, ↓1): C5, C7, C8, C9, B3, B6, A4b, A8, A9

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ MEANINGFUL PROGRESS — and **now visible** in the tile |
| Ownership history not in unison | ✅ FIXED + auto-close trigger prevents recurrence + **visible** |

## Audit-log inventory (LCC Opps)

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 30 | B8_domain_health_tile_2026_05_27_001 | all | 0 (UI/infra only) |

## Migrations applied this round

| Project | Migration | Purpose |
|---|---|---|
| dia | `dia_v_sf_link_queue_summary_b8` | Per-status SF-link queue aggregate |
| gov | `gov_v_sf_link_queue_summary_b8` | Same on gov |

JS / Edge Function changes:
- `ops.js` — `renderDomainHealthSummary()` + `_opsSparkline()` + `_opsTrendSeries()` + anchor div + hydration call
- `supabase/functions/data-query/index.ts` — 8-view allowlist extension on both domains

## Recommended priorities for next session

1. **C8 — RCM/LoopNet auth fix** (small, unblocks a dark BD channel; can be batched with another item)
2. **C5 — EXCLUDE constraint hardening** (formalize what A6a's trigger enforces de facto)
3. **A4b — deed-records orphans research** (232 dia + 88 gov true orphans needing triage)
4. **B6 — provenance review queue staffing** (Phase 4 Tier A already has a UI; needs the data side maintained)
