# Round 68-A — Task 1 Re-Date Plan (verification gate)

> **Status: NO RECEIPT-BASED RE-DATES SHIP.** Per Scott's direction: a 2026-dated
> listing stays 2026-dated unless a receipt says otherwise. Task 1 is re-scoped
> from a one-time backfill to a **go-forward, receipt-based capture fix**. The
> bulk row plan below is therefore **empty by design** — and that is the correct
> answer, not a gap.

## Why no rows re-date now (the hypothesis was killed)

The original brief hypothesized 2025-vintage listings were captured with
defaulted 2026 dates. Three independent checks against live Dialysis_DB
(2026-06-04) show **no evidence exists to move any listing into 2025**:

| evidence channel the brief named | finding |
|---|---|
| `created_at` vs `listing_date` | `created_at` is **NULL** on ~all rows → useless for re-dating |
| `raw_text` "Days/Date on Market" markers | **0** rows carry any DOM marker (only 47 rows have any raw_text) |
| OM-intake staging date (`staged_intake_items.created_at`) | the OM-intake system's earliest record is **2026-04** → every OM intake is genuinely 2026-vintage |

And the structural split confirms it: the **organic** capture channel (the one
that fed 2017–2024) collapsed in 2025 on its own (8 listings vs 125 in 2024);
the 2026 "clump" of 105 date-defaulted rows are **all OM-intake rows whose true
`staged_intake.created_at` is in 2026-04…06** — re-dating them to their receipt
moves them *within* 2026, never into 2025. The 35 OM rows dated 2017–2025 sit on
**unique, content-derived dates** (not defaults), so they are left untouched.

```sql
-- organic channel collapsed in 2025, not a date bug:
SELECT extract(year from listing_date)::int yr,
  count(*) FILTER (WHERE notes ILIKE 'Staged from LCC OM intake%') om_intake,
  count(*) FILTER (WHERE notes IS NULL OR notes NOT ILIKE 'Staged from LCC OM intake%') organic
FROM available_listings WHERE listing_date>='2017-01-01' GROUP BY 1 ORDER BY 1;
-- ... 2024: om 14 / organic 125  |  2025: om 12 / organic 8  |  2026: om 131 / organic 13
```

**The sold share of the 2025 hole is recovered by Task 2** (sale-date-anchored,
real evidence) — see `R68A_SYNTHESIS_PLAN.md` (2025: 20 → 99 combined).

### Per-row re-date plan

`[]` — zero rows. No receipt channel currently yields a marketing-start date
that contradicts a stored `listing_date` by > 30 days. Inference-based re-dates
do not ship (Scott's rule). If/when the capture fix below produces receipts,
they re-date **one row at a time, with the receipt attached**, through the
provenance path — never as a bulk guess.

## The go-forward capture fix (two channels)

### Channel 1 — availability-checker page markers (re-dates existing actives)

The `availability-checker` Edge Function already fetches each active listing's
CREXi / CoStar / LoopNet page every 6h. Those pages frequently expose a
marketing-start marker — **"Listed on", "Date on Market", "Time on Market",
"Days on Market"**. R68-A adds marker extraction to the parser and a
`listing_date` correction path:

- New parser fields (`parsers.ts → ParseResult.listed_on` / `.days_on_market`):
  per-site regex + JSON-LD (`datePosted`) extraction of the marketing-start date.
- New worker step (`index.ts`): when a parsed marketing-start date **predates the
  stored `listing_date` by > 30 days**, call the new RPC
  `dia_record_listing_date_correction(listing_id, new_date, source_url, marker)`,
  which:
  - PATCHes `available_listings.listing_date` and stamps
    `listing_date_source = 'page_marker'`;
  - writes a `field_provenance` row tagged `source='availability_scraper'`,
    `field_name='listing_date'` through `lcc_merge_field` (same path as the
    `url_status` provenance the worker already writes).
- The 143 currently-2026-stamped actives get re-dated **organically over the next
  probe cycles, with receipts** — not guesses. Rows whose pages carry no marker
  keep their capture date (documented residual, below).

This ships as code in this branch (`supabase/functions/availability-checker/*`,
plus the RPC migration). It is **go-forward** — it writes nothing until the next
cron tick fetches a page that actually carries a marker.

### Channel 2 — sidebar "Date on Market" capture (stops the hole re-forming)

`api/_handlers/sidebar-pipeline.js` writes new listing rows at CoStar-capture
time. R68-A captures CoStar's **"Date on Market"** field into `listing_date`
(tagged `listing_date_source='costar_date_on_market'`) when present, instead of
defaulting to the capture date. New captures therefore never re-create this class
of hole.

## Accepted, documented residual

Actives captured in 2026 whose pages carry no marker keep their capture dates.
This is a **known undercount of the 2025 active universe**, **partially
self-healing** via Channel 1 as pages are re-probed. It is noted in the view docs
(`R68A_VIEW_MATRIX.md` → "Known residual"). We do not fabricate dates to close it.

## Deliverables in this branch (Task 1)

- `supabase/functions/availability-checker/parsers.ts` — marker extraction.
- `supabase/functions/availability-checker/index.ts` — correction step.
- `supabase/migrations/20260605_cm_round68a_dia_listing_date_correction_rpc.sql`
  — the receipt-gated `dia_record_listing_date_correction` RPC.
- `api/_handlers/sidebar-pipeline.js` — Date-on-Market capture.
- `listing_date_source` column (shared with Task 2's column migration).
