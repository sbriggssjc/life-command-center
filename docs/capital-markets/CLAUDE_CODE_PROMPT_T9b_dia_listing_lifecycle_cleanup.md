# Claude Code prompt — T9b: dia listing-lifecycle cleanup + fix close-on-sale (the zombie-active listings)

> Surfaced by T9 (dia asking-cap quartiles sticky; ~392d→really ~2,019d median DOM on "active" listings).
> Grounded: `available_listings` has a **status ↔ off_market_date integrity break** — ~890 listings are
> flagged open that shouldn't be, the close-on-sale triggers are missing sold properties, and the
> verification process re-stamps sold-property listings as freshly "active." This pollutes the available
> count, the asking-cap pool, and DOM. Resolve the data AND the root cause. dia `zqzrriwuavgrquhisnoa`.
> Data-write cleanup + trigger fix; reversible (capture prior state); no fabricated dates. ≤12 api/*.js.

## Receipts (grounded live 2026-06-25, dia `available_listings`)
Listings with **`off_market_date IS NULL` by status:** `active` 685 · `off_market` **400** · `superseded`
**128** · `sold` **77** · `under_contract` 1.
- **363 open listings are on a SOLD property** (the property has a `sales_transactions` row): all **77**
  `status='sold'` (100% have a `sale_transaction_id` + a property sale); **286 of the 295** `status='active'`
  zombies (DOM > 730d); **105** superseded; **50** off_market. These are unambiguously not active — the
  property sold — yet they're open.
- **The freshness gate is meaningless here:** those 286 active-on-sold-property zombies carry
  `last_verified_at` of **2026-05-19 … 2026-06-25** (this month) — the verification/availability process
  stamped them "freshly verified active" though the property sold. So `last_verified_at < 12mo` is NOT a
  reliable "still on market" signal.
- **528 `off_market`/`superseded` listings carry a NULL `off_market_date`** — not-active by status, never
  closed out (off_market: 265 have an `off_market_reason`, 130 a `last_verified_at`; superseded: 84 reason,
  105 on a sold property).
- **The close-on-sale machinery EXISTS but misses them:** triggers `trg_close_listing_on_sale` (AFTER INSERT
  on `sales_transactions`) + `trg_listing_close_if_sold` (BEFORE INSERT/UPDATE on `available_listings`), and
  functions `close_listing_on_sale` / `fn_sale_event_mark_listings_sold`. 363 sold-property listings stayed
  open AND were UPDATEd (verified) this month without the BEFORE-UPDATE close firing → the matching condition
  has a gap.

## Unit 1 — backfill-close listings on sold properties (the unambiguous set, ~363)
For every open listing (`off_market_date IS NULL`) whose property has a sale, close it: `off_market_date` =
the property's matching sale date (prefer `sale_transaction_id`'s sale; else the most-recent
`sales_transactions.sale_date` for the `property_id` that is ≥ the listing's `on_market_date` when one
exists, else the most-recent sale), `off_market_reason='sold'`, `status='sold'`. Capture prior
(status, off_market_date) for reversibility. No fabricated dates — every date comes from a real sale.

## Unit 2 — close the status-says-not-active set (~478 remaining)
For `status IN ('off_market','superseded')` with `off_market_date IS NULL` and NOT already closed by Unit 1
(not on a sold property): set `off_market_date` from the best real signal — `last_verified_at` if present
(when it was last confirmed off/checked), else a conservative estimate flagged via `off_market_reason`
(e.g. `superseded`/the existing reason); preserve any existing `off_market_reason`. Superseded rows: prefer
the superseding listing's `on_market_date` for that property if identifiable. Do NOT invent a precise date
where none exists — flag the estimate in `off_market_reason`. These are not-active by their own status; the
goal is to stop them leaking into "active," with the most defensible exit date available.

## Unit 3 — fix the root cause (so this doesn't re-accumulate)
Diagnose WHY `trg_close_listing_on_sale` / `trg_listing_close_if_sold` / the close functions miss sold
properties (read the bodies — likely a matching-window or key condition: e.g. it keys `listing_date` vs
`sale_date`, requires a live/non-excluded sale, matches on address not `property_id`, or the verification
UPDATE path doesn't satisfy the BEFORE-UPDATE condition). **Report the diagnosed gap**, then fix so:
(a) a new sale auto-retires that property's open listings (close-on-sale actually fires), and
(b) the verification/availability process does NOT re-stamp or keep-active a listing whose property has sold
— a sold-property check overrides the freshness gate. Reuse the existing functions; don't fork a parallel
mechanism. (NB: the LCC `v_data_quality_issues` already names `listing_after_sale` — this is that, fixed.)

## Unit 4 — verify downstream (report before/after)
After Units 1–3, report: (a) active-listing count before/after (raw `status='active' & off_null`, AND the
canonical CM available count `cm_dialysis_active_listings_m` membership + the freshness-gated headline — does
the ~119 headline move, and is it now genuinely-active?); (b) the **asking-cap quartile pool**
(`cm_dialysis_asking_cap_quartiles_active_m`) — does removing the zombies shrink it and **unstick the T9
sticky quartiles**? report the pool size + quartile movement before/after; (c) DOM median on the cleaned
active pool (should fall from ~2,019d to a plausible on-market range).

## Gate (verify live)
- **0** open listings (`off_market_date IS NULL`) on a sold property; **0** rows with `status IN
  ('sold','off_market','superseded')` AND `off_market_date IS NULL`.
- Close-on-sale gap diagnosed + fixed: a fresh test sale (synthetic, rolled back / cleaned up) closes its
  property's open listing; the verification path no longer keeps a sold-property listing active. Report the
  diagnosed condition.
- Unit 4 before/after reported (active count, canonical headline, asking-cap pool + quartile movement, DOM).
- Reversible (prior state captured); no fabricated dates (sold→sale date; off_market→real signal or a
  flagged estimate); genuinely-active listings preserved; ≤12 api/*.js. dia only.

## Boundaries / scope
- This is the listing **EXIT** side (off_market_date / status / close-on-sale). Do NOT touch the T4c
  **ENTRY** side (`on_market_date` and its sources) or the gov listings (separate). `listing_date` stays
  raw/audit per T4c.
- Closing ~890 listings will materially drop the raw open population — that's the correction, not a
  regression. Confirm the canonical CM available count reflects genuinely-active inventory and report the
  honest number. Don't close a listing that is genuinely still on-market (no sale, status=active, plausibly
  current) — Unit 1/2 only touch sold-property or status-says-not-active rows; the residual long-DOM
  active-status-not-sold rows (the ~9 of 295) are a separate judgment call, surface them, don't auto-close.
