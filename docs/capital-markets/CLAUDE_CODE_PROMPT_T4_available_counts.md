# Claude Code prompt — T4: available / "added-to-market" deal counts (recover history, explain the spike)

> Catalog topic **T4** (dia 5/8/11/12, gov 27/29/30). Scott: counts "significantly lower prior to
> 2025," "market should add >20/month," "huge spike in 2025." Grounded receipts-first — there are TWO
> distinct metrics conflated here, one recoverable and one a genuine floor. dia `zqzrriwuavgrquhisnoa`,
> gov `scknotsqkcheojiaewwh`. Verification + targeted fix; honest about the real floor.

## Receipts (dia `available_listings`, listing-date by year)
| year | listings added | still active | ≈/month |
|---|---|---|---|
| 2018 | 348 | 0 | 29 | 2020 | 298 | 0 | 25 | 2022 | 244 | 1 | 20 |
| 2024 | 300 | 39 | 25 | 2025 | 314 | 67 | 26 | **2026 | 698 | 586 | 58** |
- **"Added to market" history EXISTS back to ≥2018** (~25-29/mo) via `listing_date` — these are listings
  that came to market and have since sold/closed. So Scott's ">20/mo" is right; a chart showing a
  pre-2025 fall-off is **undercounting**.
- **Active-STATUS tracking began only 2022-07** (the canonical point-in-time active count, ~119).
- **2026 = 698 listings / 586 still 'active'** — a 2x jump vs 2025, and 586 raw-active vs the canonical
  **119** point-in-time active.

## The two metrics — classify and treat differently
1. **Point-in-time ACTIVE count ("how many on the market as of date D")** — genuine collection floor at
   **2022-07** (no active snapshots before then). Canonical = `cm_dialysis_active_listings_*` (119).
   Keep these charts honestly floored at 2022; do NOT fabricate earlier point-in-time counts.
2. **"ADDED to market" / new-listings-per-period (the turnover "No. Added" + inventory-backlog series)**
   — this is **recoverable from `listing_date` back to ≥2018** (~25-29/mo) and is currently
   undercounted (it appears to derive "added" from the 2022+ active-capture instead of listing_date).
   **Fix:** compute "added per period" from `listing_date` of ALL listings (regardless of current
   status), so the series shows the real ~25-29/mo history pre-2022 and removes the artificial fall-off.

## The 2026 spike + the 586-vs-119 gap (investigate, report)
3. **Explain the 2026 jump** (698 listings / 58-per-mo vs 26 in 2025): is it a real market surge, or a
   **capture-rate change** (the CoStar sidebar capturing many more listings starting late-2025/2026)?
   Check `created_at`/capture date vs `listing_date`, and the source. Report which — if it's a capture
   artifact, the "added" line will show a false spike that needs normalizing, not celebrating.
4. **Reconcile 586 raw-active (2026 `status='active'`) vs the canonical 119** — duplicates, multiple
   listings per property, or stale-active rows never marked off? The canonical de-dupe is the truth for
   the point-in-time count; confirm the "added" metric isn't double-counting the same property.

## Apply to gov too
gov has the same `available_listings` architecture and the same notes (27/29/30). Run the identical
classification + the listing_date-based "added" recovery + the spike/dup checks on gov; report its
numbers in the same shape.

## Gate
- "Added to market per month" shows the real ~25-29/mo (dia) back to ≥2018, no artificial pre-2022/2025
  fall-off; gov equivalent recovered.
- Point-in-time active count stays honestly floored at 2022 (not fabricated earlier).
- The 2026 spike is explained (real vs capture-rate) with receipts; the 586-vs-119 gap reconciled (one
  property → one count).
- Reversible; no fabricated points; the genuine 2022 active-floor is preserved, not papered over.

## Boundaries
Distinguish "added" (recoverable from listing_date) from "active-as-of" (real 2022 floor) — do not
conflate them. Verification-first on the spike; only normalize if it's proven a capture artifact.
