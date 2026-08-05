# Prompt 45 — Recover/backfill price adjustments (original-vs-current ask) — both DBs

## Why (Scott's note, 2026-08-05)
PRICE CHG (and bid-ask) under-populate because original-vs-current ask isn't fully captured — only ~11 dia
on-market rows currently show a change. But the history EXISTS and is recoverable:
- **gov** already has `available_listings.original_price`, `last_price_change`, `price_change_count` (+ `sales_
  transactions.initial_price/had_price_change`, `listing_verification_history.prior_asking_price`).
- **dia** has `available_listings.initial_price` + `listing_snapshots` (1,310 listings), `listing_verification_
  history.prior_asking_price` (7,097 rows), `v_property_ask_history` (2,987 rows). (`price_change_history` col is empty.)

## Task
1. **gov — wire the native fields.** Point `v_gov_on_market_full` + the rpc on-market arm to
   `available_listings.original_price` as INITIAL PRICE / initial ask (and `price_change_count`/derived flag), so
   every repriced gov listing shows PRICE CHG. No reconstruction needed — the columns are populated.
2. **dia — backfill `initial_price` (original ask)** where NULL, reconstructing per priority:
   earliest `listing_verification_history.prior_asking_price` → earliest `listing_snapshots` ask →
   `v_property_ask_history` earliest. Set `had_price_change` when the recovered original ≠ current asking.
   Additive, reversible, provenance-tagged (`initial_price_source`), never fabricated (NULL when no history).
3. **Re-point the enriched views/RPC** (`v_dia_on_market_full`, `v_gov_on_market_full`) to the recovered
   original-vs-current so INITIAL/LAST PRICE, INITIAL/LAST CAP, and PRICE CHG reflect the full history — not just
   the handful captured today. Caps must still reconcile to the shown price.
4. **Prevent recurrence:** `listing_sync` ingestion should write the original ask on first sight and append each
   reprice to `listing_price_history` / a snapshot, so future changes are captured natively (the gap flagged in 42).

## Verify
- A materially larger share of on-market rows (dia + gov) show a PRICE CHG — approaching the real repriced share,
  not ~11. Recovered originals tie to a dated source row; caps reconcile; nothing fabricated (— where truly silent).
