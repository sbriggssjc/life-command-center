# Prompt 50 — Comps: propagate closed sales into the master comp workbook (we're missing ~72% of recent sales)

## Why (live comp build, 2026-08-05)
Building The Villages appraisal comps, Scott's own Fresenius Woodland Hills sale (20931 Burbank Blvd, closed 2026-07-24, $15.73M, 6.00% cap, ~12 yr) did NOT appear. Root cause: the sale is recorded in `available_listings` (listing 14879: sold_price, sold_date, cap), and the PROPERTY is in `dia_master_comp_workbook` with lease details (rent $943,794, lease to 2038-08-31), but the SALE fields (sold_price / sold_cap / sale_date) in `dia_master_comp_workbook` are NULL — the close never propagated into the master comp workbook, which is the table the comps engine reads for sold comps.

Scope: of 381 sold dialysis in `available_listings` in the last 18 months, **274 are missing from the master comp workbook's sold set** (join on normalized address). We are systematically missing recent closings — including our own.

Also observed: `available_listings.cap_rate` is unreliable/mislabeled on some records (Woodland Hills shows 6.62% there, but rent÷price = 6.00%, which is correct). The workbook computes cap = rent ÷ sold_price, so the trustworthy inputs are rent (from master/lease) and sold_price (from available_listings).

## Task
1. **Propagate closed sales into `dia_master_comp_workbook`.** For each `available_listings` row with a real `sold_date` + `sold_price` whose property matches a master workbook row (by normalized address / property linkage), populate the master row's `sold_price`, `sale_date`, and `initial_price`/`last_price` where present. Compute/refresh `sold_cap` as rent ÷ sold_price (the verified basis), NOT the raw `available_listings.cap_rate`. Prefer the verified sale over a stale/blank one. Do this as a reviewable backfill (dry-run counts → review lane → apply), reversible, never overwriting a human-verified sale silently.
2. **Where the property isn't yet in the master workbook**, create the sold-comp row from `available_listings` + `properties` (address/SF/chairs/patients) + lease source (rent/expiration/expense/bumps/options), so the ~274 missing sales become available as comps.
3. **Guardrail:** filter/rank on the DISPLAYED cap (rent ÷ price), and flag rows where `available_listings.cap_rate` disagrees with rent÷price by >25 bps for review (the mislabeled-cap cases).
4. Capture the real `on_market_date` from `available_listings` (non-synthetic) so sold comps can show DOM.

## Verify
- Woodland Hills (20931 Burbank Blvd) appears as a sold comp with sale 2026-07-24, $15.73M, cap 6.00%, term ~12 yr.
- The master workbook's 18-month sold count rises by roughly the ~274 currently-missing sales (report the exact reconciled number; log anything intentionally skipped).
- No existing human-verified sale is overwritten; backfill is dry-run/review/apply and reversible.
