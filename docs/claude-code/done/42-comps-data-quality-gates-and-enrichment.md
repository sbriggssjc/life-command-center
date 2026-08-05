# Prompt 42 — Comps DATA-QUALITY gates + missing-field enrichment (view/engine, both DBs)

## Why (Scott's export notes, 2026-08-05)
Impossible/blank values are reaching the export: **negative or 2,000+ DOM** (bad/after-sale list dates),
**negative bid-ask spread** (sold recorded above ask — almost never real), **no price-change shown on on-market**
(the enriched view stores only one asking price, so initial=current for every row), plus missing patient counts,
land size, bumps, renewal options, and a few expense structures.

## Task
1. **DOM gate.** A sold comp's ON MARKET (list) date is valid only if it is BEFORE the sale date and within a sane
   window (≈≤1,500 days). Otherwise NULL it so DOM stays blank — never emit negative or multi-thousand-day DOM.
2. **Bid-ask gate.** Populate INITIAL/LAST PRICE (ask) only when the ask is ≥ the sale price (normal down-
   negotiation); when sold > ask, treat the ask as unreliable → NULL it (no negative bid-ask), and flag for review.
3. **On-market price-change history.** `available_listings` / the on-market path must retain the **original ask**
   distinct from the **current ask** (and their caps) so INITIAL≠LAST when a listing was repriced and PRICE CHG
   populates. Today `v_*_on_market_full` collapses both to one `asking_price` (price_changes=0). Capture/expose the
   ask history so >half of actively-repriced listings show a change.
4. **Enrich missing fields to sold-parity:** SOLD renewal options (join `leases`, like on-market now does),
   patient counts and land size (backfill from `facility_patient_counts` / `v_property_detail` / property record),
   and expense structure where the lease record has it. "—" only where truly not on file — never fabricated.
5. Apply to dia and gov; additive/reversible; document the gates in the migration headers.

## Verify
- No sold comp shows negative or >1,500-day DOM; no negative bid-ask.
- Repriced on-market listings show a PRICE CHG; a materially larger share of rows carry patients, land, bumps,
  renewal options, and expense structure than before.
