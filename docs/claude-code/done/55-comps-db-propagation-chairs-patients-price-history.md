# Prompt 55 — Data integrity: chairs/patients propagation + listing price-history ingestion

## Why (live comp build, 2026-08-05)
Two DB-level gaps surfaced while building The Villages comps — both cause blanks/zeros in the export that are NOT
true "no data," they're propagation/ingestion failures.

### A. Chairs/patients present in `properties` but not reaching comps
Of 7 comp rows missing chairs/patients, **2 have the data in `properties` and it simply didn't join**:
- **2500 Swamy Dr** — `properties.total_chairs = 13`, but the comp shows blank.
- **1205 Martin Luther King Jr Blvd** — `properties.total_chairs = 10` (and **2 property records** for the address —
  a duplicate splitting data), comp shows blank.
The other 5 (incl. 20931 Burbank / Woodland Hills, 9341 East 21 St [also 2 records], 1325 Ms-4, 76 Old Rock Springs,
3204 Old Forest) are genuinely absent everywhere — a data-acquisition backlog, not propagation.
Root cause of the propagation misses: the comp path's chairs/patients join is by normalized address and misses when
the sale/listing address string differs from `properties.address`, and duplicate property records split the counts
(Prompt-51 territory).

### B. Listing price-history is essentially un-ingested -> PRICE CHG is almost always 0
`listing_price_history` has **1 row total**. `available_listings` shows a price change (initial <> last /
`had_price_change`) on only **33 of 453 active** dialysis listings (~7%). So the On Market PRICE CHG / INITIAL vs
LAST columns are blank/zero for almost every listing — not because prices held, but because we never captured the
initial ask vs the current ask when a listing re-priced. Real CRE listings re-price often; we're missing that history.

## Task
1. **Chairs/patients join hardening + backfill.** Make the comp/on-market path resolve chairs/patients through the
   property **link (property_id)** and a robust address match (not a brittle string prefix), and pull from the
   consolidated canonical record so a duplicate doesn't hide the count. Backfill `2500 Swamy Dr` (13) and
   `1205 MLK Blvd` (10) — and any others where `properties`/`medicare_clinics` already hold the count but the comp
   shows blank. Report how many rows this recovers. (Do NOT invent counts where none exist — those stay "Not on file".)
2. **Ingest listing price history so PRICE CHG is real.** Populate `listing_price_history` (or the on-market view's
   INITIAL vs LAST) from the sources we already scrape — CoStar/LoopNet price-change events, `available_listings`
   snapshots (`listing_snapshots`, `listing_price_history`, `price_change_history`), and re-scrape deltas — so a
   listing that re-priced shows its initial ask, current ask, and PRICE CHG. Set `had_price_change` accordingly.
   Where we truly only ever saw one ask, INITIAL = LAST is correct (PRICE CHG 0); the fix is capturing the ones that
   DID move. Reviewable/reversible; don't fabricate a change that didn't happen.

## Verify
- 2500 Swamy Dr and 1205 MLK Blvd (and similar) show their chairs/patients in a fresh comp pull; report the recovered count.
- After ingest, the share of active dialysis listings with a captured price change rises materially above the current
  ~7%, and On Market PRICE CHG / INITIAL vs LAST populate for listings that actually re-priced.
- No fabricated counts or price changes; genuine gaps remain "Not on file" / INITIAL = LAST.
