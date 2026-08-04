# Prompt 29 — Comps pull/export polish (dedup, cap band, field mapping, display format)

Near-term fixes that need NO new data (the SOURCE-coverage gaps are the separate prompt 30 program). Diagnosis +
measured null-rates: `docs/architecture/comps-data-integrity-and-canonical-record.md`.

## 1. Dedup to one canonical row per property-sale
610 properties have >1 `transaction_state='live'` sold row (portfolio-allocation + multi-source dupes of the same
event, e.g. Pembroke Pines 8100 Johnson St appearing twice). In the comps pull, collapse rows that represent the
SAME sale event (same property_id + overlapping sale_date/buyer/price, or a portfolio-allocated price) to ONE
best-sourced row; keep genuinely distinct repeat sales but, for an appraisal set, surface only the most relevant
(most recent reconciled) per property unless the user asks for sale history.

## 2. Fix EXPORT-mapping gaps (data exists in the DB, isn't reaching the workbook)
- **On-market date for SOLD (#7):** `on_market_date` is populated on 100% of linked listings but blank in the Sold
  sheet — map it through to the ON MARKET column (and DOM then computes).
- **On-market SHEET fields (#10):** active listings carry initial_cap (63%), on_market_date (89%), etc., but the
  On Market rows come back mostly empty — map every field the on-market listing record has (mirror the Sold-sheet
  mapping fixed in prompt 28).
- **Initial/last price + cap:** map `initial_price`/`initial_cap_rate`/`last_price`/`current_cap_rate` wherever the
  linked listing has them (they're sparse at source — that's prompt 30 — but show what exists).

## 3. Standardized bumps/options display format (#4)
Normalize in the export: **bumps** → `X.X%/yr` (or `X% every N yrs` when stepwise); **renewal options** →
`(N) M-yr` (e.g. `(2) 5-yr`). One consistent representation regardless of source string.

## 4. Appraisal cap band + error exclusion (#9, #10)
Appraisal mode must (a) exclude obvious ERRORS always: caps < ~4.0% and the garbage highs (there are 3 active
listings >12%, incl. the 19%) — sale_price ≪ NOI, portfolio-allocated non-cap prices; (b) build the PRIMARY set as
a **subject-relative band** — for a 6.00% subject, cluster ~5.5-6.75% (905 comps exist in that band); real comps
outside the band go to a clearly-labeled secondary/market-range section, NOT the primary value-support set. Band
width configurable; centered on the resolved subject cap.

## 5. Verify
- No duplicate property/address in the sold set; Pembroke Pines etc. collapse to one row.
- Sold sheet shows ON MARKET dates + DOM; On Market sheet rows are populated (not near-empty); no 19% cap listing.
- bumps/options render in the standard format across all rows.
- Primary sold set sits in the subject band; errors excluded; out-of-band reals labeled secondary.

## Note
This is export/pull LOGIC only. The missing initial price/cap (62% blank), last ask (36%), chairs (27%), leases
(16%) are SOURCE-coverage gaps handled by the canonical-record program (prompt 30). Don't fabricate — show "Not on
file" where the DB is genuinely empty.
