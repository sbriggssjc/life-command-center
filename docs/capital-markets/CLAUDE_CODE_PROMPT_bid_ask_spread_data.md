# Claude Code follow-up prompt — fix the bid-ask spread data (last_cap_rate is copied from sold cap)

> Add this to the SAME Claude Code chat that's working the `rent_at_sale` prompt — it's the
> same data-integrity family (the bid-ask chart's caps aren't independently captured).
> Run in the **DialysisProject** repo.

```
Follow-up to the rent_at_sale investigation: the Bid-Ask Spread chart is flat because the
underlying spread is ~0, and I've traced exactly why. Fix the data capture.

## The symptom (measured 2026-06-01, Dialysis_DB ref zqzrriwuavgrquhisnoa)
- `cm_dialysis_bid_ask_spread_m` computes the per-deal spread as
  `available_listings.cap_rate` (achieved/sold cap) − `available_listings.last_cap_rate`
  (last asking cap), averaged over the TTM of SOLD listings.
- Of 712 sold listings that have BOTH caps in 4–12%: **503 (71%) have
  `last_cap_rate` EXACTLY equal to `cap_rate`** — i.e. the last-ask cap was copied from
  the sold cap, not captured independently. Only 209 carry a real difference (avg |diff|
  31 bps). Averaging all 712 washes the spread to ~0.
- Even the 209 genuine-diff deals are noisy and centered near zero by year
  (−17 to +62 bps), NOT the deliverable's clean +44–69 bps.
- The published deck (The Dialysis Market Filter p.34) shows a consistent positive
  spread because the master comp workbook HAND-ENTERS distinct LAST CAP (last asking) and
  SOLD CAP (achieved) per comp. Ours doesn't.

## Tasks
1. CONFIRM and quantify: rerun the 712 / 503-equal / 209-differ split; break the "exactly
   equal" rows down by `rent_source` / ingest source / created_at to see which pipeline
   copies `last_cap_rate` from `cap_rate`.
2. TRACE every writer of `available_listings.last_cap_rate` (CoStar sidebar capture, OM
   intake, listing scraper, manual/CSV). Find where it defaults to / is set equal to the
   sold `cap_rate` instead of the listing's true LAST ASKING cap (last asking price ÷ NOI).
3. FIX the capture: populate `last_cap_rate` from the listing's last asking price and the
   same NOI used for the sold cap, independent of the achieved cap. Where the last asking
   price is unknown, leave `last_cap_rate` NULL (so the spread is computed only on deals
   with a genuine, independent last ask) rather than copying the sold cap. Backfill where
   `last_price`/`initial_price` exist on `available_listings`.
4. ALSO relax the view's `achieved_last_ask_cap` gate in `cm_dialysis_bid_ask_spread_m`:
   it currently requires `n_with_last_cap >= 5 AND n_with_spread >= 5`, which leaves it
   NULL in recent months. The chart's top marker (Achieved cap) needs it populated wherever
   `avg_last_ask_cap` and `avg_bid_ask_spread` both exist.
5. VALIDATE: after the fix, `SUM` / per-year average of the per-deal spread on real deals
   should be a coherent positive band (the deck's order of magnitude, ~30–70 bps), and
   `achieved_last_ask_cap = avg_last_ask_cap + avg_bid_ask_spread` should populate. Show a
   per-year before/after spread table.

## Why it matters
The chart itself is already rebuilt to the master's structure (single cap axis, light-gray
floating bar from Last Ask up to Achieved, sky dash marker at the bottom, navy dash marker
at the top — verified to render correctly with realistic spread data). It's flat ONLY
because the spread data is ~0. This fix makes the chart match the deck.

## Constraints
- Follow the repo's git rules (feature branch, PR, copy/paste merge + test commands).
- Backfills record provenance; never clobber a manually-corrected `last_cap_rate`.
- Don't change the sold `cap_rate` — it's the achieved side and is correct.

## SAME-FAMILY follow-on: available_listings.initial_price copy bug (% of Ask chart)
The "Days on Market & % of Ask Price" chart (Dialysis Market Filter p.33) has the
identical defect on the PRICE side of available_listings:
- `cm_dialysis_dom_pct_ask_m` computes % of ask as `sold_price / initial_price`.
- Of 828 sold listings with both prices in range, 278 (33.6%) have `initial_price`
  EXACTLY equal to `sold_price` (copied, not the true broadly-marketed first ask),
  and another 174 (21%) have `sold_price > initial_price` (implausible). Median
  ratio = 100%. That inflated the line to ~98-100% (sale price >= ask, which can't
  be right); the deck shows a realistic 88-95% band (avg ~93.7%).
- Display was patched (view now trims `sold/initial_price` to a strict `< 1.0`
  window, R66n, ~91.4% on 348 genuine deals), but the DATA is still wrong.
- TASK: trace every writer of `available_listings.initial_price` (and `last_price`),
  find where it defaults to / is set equal to `sold_price`, and fix capture so
  `initial_price` = the FIRST broadly-marketed asking price (independent of the
  eventual sale). Where the true initial ask is unknown, leave NULL rather than
  copying `sold_price`. Backfill from listing-history/price-change records where they
  exist. Validate: post-fix `avg(sold_price/initial_price)` over genuine deals ~ the
  deck's 88-95% and the share of `initial_price = sold_price` rows drops toward 0.
```
