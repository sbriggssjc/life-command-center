# R74e Task 6c — dia listing_date backfill + stop the over-stamp writer

> DRY-RUN analysis, 2026-06-10. Phase A (writer fix) committed as migrations;
> Phase B (backfill) carries a **recommendation against the naive backfill** that
> needs Scott's adjudication before any date write.

## Phase A — root cause + STOP the writer (committed)

**Writer:** `public.lcc_record_listing_check` (both dia + gov). The off-market
stamp:

```sql
off_market_date = CASE
  WHEN p_check_result IN ('off_market','sold') AND off_market_date IS NULL
       THEN COALESCE(p_effective_at::date, CURRENT_DATE)   -- no upper bound
  ELSE off_market_date END
```

`CURRENT_DATE` is never future, but `p_effective_at` is a caller-supplied
timestamp. A caller that forwards a **future** value (e.g. a verification-cadence
/ next-due timestamp passed as the effective date) lands a **future**
`off_market_date`. For an undated row the turnover view then synthesizes
`eff_start = off_market - 196d` (a fake-recent start) which passed every
active-count gate — the #9 inflation wall (migration `20260716`).

Callers checked: the availability-checker Edge function and `lcc-auto-scrape-listings`
both call the RPC **without** `p_effective_at` (default `now()`); the
availability-promotion-sweep passes a real past `sale_date`. So no *current*
caller passes a future date — consistent with the live data now showing **0**
future-off_market rows (the ~222 the #9 fix saw have since elapsed into the past).
The over-stamp is therefore dormant, but unguarded.

**Fix (caller-agnostic, minimal):** clamp the stamp to `CURRENT_DATE`:

```sql
v_eff_date date := LEAST(COALESCE(p_effective_at::date, CURRENT_DATE), CURRENT_DATE);
```

applied to both `off_market_date` and `price_change_date`/`last_price_change`.
`off_market_date` can never be set in the future from this function again,
regardless of which cron/edge/handler calls it. All other behavior byte-identical.

Migrations (committed, **not yet applied** — apply after Scott's review):
- `supabase/migrations/dialysis/20260610120000_dia_r74e_task6c_phaseA_listing_check_future_offmarket_clamp.sql`
- `supabase/migrations/government/20260610120000_gov_r74e_task6c_phaseA_listing_check_future_offmarket_clamp.sql`

## Phase B — backfill listing_date: **the naive backfill is the wrong lever** (needs Scott's call)

### What the undated population actually is (dia, 1,698 rows)

| segment | count | datable evidence |
|---|---:|---|
| closed, has off_market_date, has sale anchor | 1,230 | tier-3 sale-anchor only (created_at/last_seen ~null) |
| closed-ish, has off_market_date, no sale anchor | 115 | almost none |
| limbo (is_active=false, no off_market_date) | 304 | near-zero (8 url_checked, 2 last_seen) |
| **genuinely active (is_active=true, no off_market_date)** | **49** | **only 10 have ANY capture date; 0 have a sale anchor** |

The tier-1/tier-2 ladder (availability-checker `last_checked` / CoStar capture
date) is essentially **empty** in this data — `created_at` is null on all but 1
row; `last_seen`/`url_last_checked` exist on ~125 rows but almost all are CLOSED
rows where they don't define the listing *start*. So the only broadly-available
evidence is **tier-3 sale-anchor** (`sold_date − 196d`).

### Why tier-3 sale-anchor must NOT be backfilled into `listing_date`

The turnover view's `active_count` requires a **real** `listing_date`
(`e.listing_date IS NOT NULL`) precisely because the #9 fix found the 196d
synthetic start was illegitimate for asserting "on-market at an arbitrary past
quarter-end." Persisting `sold_date − 196d` into `listing_date` re-creates exactly
that synthetic start, and it re-enters `active_count`. Simulated impact:

| quarter-end | baseline active (live view) | + tier-3 sale-anchor | 
|---|---:|---:|
| 2024-09-30 | 179 | **231** |
| 2025-06-30 | 126 | **197** |
| 2025-09-30 | 120 | **288** |
| 2025-12-31 | **125** | **346** |
| 2026-03-31 | 101 | **207** |

The naive backfill pushes 2025-12 to **346** — a worse inflation than the
original #9 bug, and **far past Scott's ~130 expectation**. Two compounding
reasons it's wrong:

1. **It reproduces #9.** Same synthetic 196d start, just persisted.
2. **It double-counts.** There are already **1,207 `data_source='synthetic_from_sale'`
   rows** (all dated, excluded from `active_count` via `is_syn`, feeding the
   historical added-to-market series). The 1,230 undated closed rows are almost
   certainly the same sales already represented there.

### The honest read on the ~130 target

The live view **already reads ~125 active at 2025-12-31 and ~101 at 2026-03-31**
on real listing_dates — essentially at Scott's ~130 expectation. Right after the
#9 fix it was 86 at 2025-12; ongoing real captures have since lifted it to 125.
There is **no evidence-grounded backfill that lifts the recent active count toward
130 without re-inflating** — the undated universe is overwhelmingly closed
sale-anchor rows (already in the synthetic series) plus 49 active rows with almost
no datable evidence.

### Recommendation (pick one — Scott)

- **Option A (recommended): do NOT backfill tier-3.** Leave the closed undated
  rows null. The recent active count stays ~125 on real dates (honest). Optionally
  backfill ONLY the ~10 active-undated rows that have a real capture date, using
  `url_last_checked`/`last_seen` as a weak first-seen proxy, tagged
  `listing_date_source='capture_first_seen'` (low confidence; ≤10 rows, ≤ a few
  units of active-count lift). Everything else stays null + excluded, per the "no
  evidence ⇒ leave null" rule.
- **Option B: backfill tier-3 only into the historical added-to-market series**
  by tagging `data_source='synthetic_from_sale'` (NOT a real `listing_date` the
  active count reads). **Risk: double-counts the existing 1,207 synthetic rows** —
  would need a dedup pass against them first. Not recommended without that.
- **Option C: do the naive `listing_date = sold_date − 196d` backfill.** Explicitly
  re-inflates `active_count` to ~346 at 2025-12 — contradicts the #9 fix. Not
  recommended.

### gov audit (same pattern)

gov `available_listings`: **12** undated rows, **0** with a future off_market_date.
The NULL-date + future-off_market pattern effectively does **not** exist on gov.
Phase A's clamp is still mirrored to gov to keep the shared writer in lock-step.

## APPLIED 2026-06-10 (Scott-approved: Phase A + Phase B Option A)

- **Phase A: APPLIED LIVE** to dia + gov (`LEAST(..., CURRENT_DATE)` clamp on
  `lcc_record_listing_check`). Migrations also committed.
- **Phase B Option A: 0 listing_date writes** — the eligible set is empty. The 49
  genuinely-active undated dia rows have **no** capture date; the only undated
  rows that carry a capture date are `is_active=false` limbo rows (dating those
  would falsely resurrect dead listings into the active count). So there is
  nothing to safely backfill — consistent with "no evidence ⇒ leave null." The
  recent active count stays ~125 on real dates (at target). gov: 12 undated / 0
  future-off_market — nothing to do.

## Net Task-6c deliverable this round

- **Phase A writer fix: committed** (dia + gov migrations). Apply after review.
- **Phase B: no date writes.** Recommendation = Option A (leave tier-3 null; the
  recent active count is already healthy on real dates; the naive backfill is a
  #9 regression + a double-count). Awaiting Scott's pick before any `listing_date`
  write.
