# Prompt 54 — Comps engine: enforce the cap band + reliability filter on the DISPLAYED set, and join sold on-market dates

## Why (live connector export, 2026-08-05)
`generate_comps` for The Villages now runs, resolves the subject, and returns a conforming workbook — but the
DISPLAYED comp set is not appraiser-clean. Downloaded and inspected the produced workbook:
- **Out-of-band caps in the selected rows:** Sold includes 1625 Unity Way NW at **7.15%** and On Market includes
  6450 Seminole Blvd at **7.77%** — both above the subject 6.75% + 35 bps = **7.10% ceiling**. The response
  `summary` reports "6.41%-7.08%" (its "reliable sold primary set"), but the actual sheet contains higher-cap rows.
  The cap-discipline band (prompt 52 / canon v1.4.0) is being used for the summary STAT, not as a hard filter on
  the rows that ship.
- **Bad-data outliers shipped:** a Sold row with a **0.54% displayed cap and $3/SF rent**, and On Market rows at
  **0.67% cap / $8/SF and $74/SF** — rent-or-SF errors (off by ~10x). These should be reliability-filtered
  (reliable-or-exclude), not displayed to an appraiser.
- **Sold on-market dates + DOM are blank (0/25).** Prompt 50 captured real `on_market_date`, but the live sold
  path (reads `sales_transactions`) isn't joining it, so the Sold tab shows no ON MARKET date / DOM.

(For comparison, the hand-built DB-direct version filtered all of this: Sold caps 4.62-7.07%, RENT/SF 13-46, avg 6.28%.)

## Task
1. **Apply the cap-discipline band as a hard filter on the DISPLAYED set, not just the summary.** The rows that ship
   in the Sold (and on-market) tabs must obey: displayed cap = rent/price **<= subject cap + 35 bps** (<=7.10% for a
   6.75% subject), and the Sold set **average below the subject**. Comps outside the band are excluded from the
   sheet (still usable for context/stats, but not shown), never merely flagged.
2. **Reliability-or-exclude on displayed metrics.** Drop comps whose displayed **RENT/SF** is implausible for
   dialysis (outside ~12-60) or whose displayed cap is implausibly low (e.g. <4.5%) — these indicate a rent/SF/price
   error. Route the dropped ones to the existing review lane; do not ship them.
3. **Join the real on-market date onto sold comps** (non-synthetic `available_listings.on_market_date`, matched by
   property/sale) so the Sold tab shows ON MARKET + DOM where a real list date exists (leave blank, never synthetic,
   otherwise).
4. Keep everything from 52 intact (operator = similarity anchor, drop bare dupes, displayed-cap basis), and keep the
   recency guarantee (a handful of trailing ~7-9-month sales).

## Verify
`generate_comps` for "The Villages DaVita — 1050 Old Camp Rd" returns a workbook where: every Sold and On-Market
displayed cap <= 7.10%; no comp with RENT/SF <12 or >60 or cap <4.5% appears; the Sold average cap is below 6.75%;
the response `summary` cap range MATCHES the rows actually in the sheet; and Sold comps show ON MARKET/DOM where a
real list date exists. Re-download and confirm against the sheet, not just the JSON summary.

## Note (not a bug — for Scott's call)
Woodland Hills (21,080 SF) does not rank into the top-25 by pure similarity to the 6,453-SF subject — correct
behavior. If Team Briggs wants our OWN recent closings always included regardless of size, that's a separate
"always-include-our-deals" rule; say the word and I'll spec it.
