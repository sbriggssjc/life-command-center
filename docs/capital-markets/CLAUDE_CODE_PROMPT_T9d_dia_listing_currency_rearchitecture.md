# Claude Code prompt — T9d: re-architect dia listing currency on authoritative entry/exit (retire the proxy)

> The root fix behind T9b/T9c. The dia "available/active now" count rests on an unreliable currency proxy —
> `COALESCE(last_seen, url_last_checked, last_verified_at, listing_date) >= period-120` — every term of which
> is compromised: **0 of 323 active listings have EVER had a real URL check** (no live re-verification exists),
> `last_verified_at` is phantom-stamped by the auto-scrape `inferred_active` cron, `last_seen` is a frozen
> ingest stamp, and `listing_date` is often a fake `capture_date_fallback`. **Scott chose the full
> re-architecture (2026-06-26), accepting a published restatement.** Rebuild currency on AUTHORITATIVE signals:
> `on_market_date` (entry) + `off_market_date`/`sold_date` (exit) + a max-DOM age cap. dia
> `zqzrriwuavgrquhisnoa`. Restates published history (footnote it); reversible; no fabricated dates;
> ≤12 api/*.js.

## Receipts (grounded live 2026-06-26, dia)
- 323 active-open listings: **140 have `on_market_date`, 183 are NULL**; **0 were ever `url_last_checked`**
  (no live currency mechanism at all). Genuine-signal current is only ~73–87 vs the published **122** — the
  122 is propped up by fake dates + the held NULL set + the phantom cron.
- Impending **2026-06-30 active balloons to 272** (110 fake-`capture_date_fallback`-listing_date rows flood in
  via the proxy; T9c already removed the SF half).
- Currency-proxy consumers (the blast radius): **`cm_dialysis_active_listings_m` / `_q`** (the core
  membership — drives the available count, DOM, asking-cap pool, market size, turnover, backlog by
  inheritance) and **`cm_dialysis_inventory_snapshot_kpis`** (uses `listing_date`). The DQ/ops views
  `cm_dialysis_listing_verification_status` + `_listings_review_queue` legitimately use these columns (they
  are ABOUT verification) — leave them.

## Unit 1 — the authoritative currency model (the core)
Rebuild the active-membership predicate in `cm_dialysis_active_listings_m` / `_q` (and align
`cm_dialysis_inventory_snapshot_kpis`):
> A listing is **available at `period_end`** iff `on_market_date IS NOT NULL AND on_market_date <= period_end`
> AND `(off_market_date IS NULL OR off_market_date > period_end)` AND `(sold_date IS NULL OR sold_date >
> period_end)` AND `(period_end - on_market_date) <= MAX_DOM_CAP`.
- **Retire** the `COALESCE(last_seen, url_last_checked, last_verified_at, listing_date) >= period-120`
  currency proxy AND the `listing_date <= period_end` entry gate. `listing_date` stays raw/audit (T4c). Keep
  the existing `data_source <> 'synthetic_from_sale'` / `listing_date_source NOT LIKE 'sale_anchor%'`
  synthetic guards (they exclude imputed rows — still correct).
- **`MAX_DOM_CAP`**: the p90 of genuine closed dia listing DOM (T9c used **1356d**); confirm from the data and
  state it. A listing past the cap with no recorded exit is aged-out (consistent with T9c's
  `withdrawn_inferred_stale`). The cap also keeps the historical active-over-time series honest (a listing
  isn't "active" forever).
- The downstream available/DOM/asking-cap/market-size/turnover/backlog views should **inherit** this via the
  core view — confirm each reads the core membership rather than re-implementing the proxy; fix any that
  re-implement it.

## Unit 2 — resolve or exclude the 183 NULL-`on_market_date` held actives
For each active-open listing with NULL `on_market_date`, try to establish it from a **real** signal only:
a genuine `listing_date` (where `listing_date_source` is NOT `capture_date_fallback`/a fake fallback),
else `first_seen`, else the SF/created date — fill `on_market_date` with the established date (stamp
`on_market_date_source` accordingly, flagged). Those with **no real date signal** (NULL on_market + fake/NULL
listing_date) **cannot establish entry → they are excluded** from the active count by Unit 1 (no fabrication
to keep them in). Flag them (`metadata`/note) for visibility; reversible. Report how many were resolved vs
excluded.

## Unit 3 — stop the phantom writers (the T9c sibling) + sweep the T9c residual
- The auto-scrape **`inferred_active` cron** (`lcc_record_listing_check`) re-stamps `last_verified_at` on
  no-URL listings with no real check — same phantom class T9c fixed for `last_seen`. Stop it from advancing
  `last_verified_at` (or any "verified" signal) without a genuine URL/feed check. (After Unit 1 the views no
  longer read `last_verified_at`, but the phantom stamp should still be stopped so no surface trusts it.)
- **Sweep the T9c residual:** `listing_id 8609` + any other `unestablished_historical` siblings that T9c's
  `sf_on_market_date`-scoped pass missed (close/clear the same way).

## Unit 4 — restatement + verify (report before/after)
This **restates published history** (Scott accepted) — the active-over-time series now reflects authoritative
on-market→off-market spans, not the proxy. **Footnote** the affected charts/report ("dia active-listing
series restated 2026-06-26 to an authoritative on-market/off-market basis"). Report:
- **2026-03-31** active count: 122 → the new authoritative count (expect a drop toward ~73–122); list what
  left and why (held NULL set excluded / aged-out / fake-date).
- **2026-06-30** active: 272 → the genuine count (the surge is gone).
- **Asking-cap quartiles** (`cm_dialysis_asking_cap_quartiles_active_m`): pool size + quartile values
  before/after — the **T9 stickiness should finally break** (the stale-cap anchors leave the pool). This is
  the ultimate T9 fix.
- **Active DOM median**, **market size**, **turnover/backlog** before/after — sanity-check each reads sane.
- Confirm no genuinely-current listing (real recent on_market_date, not exited) was wrongly dropped.

## Gate
- The core active views use the authoritative entry/exit/age-cap model; the proxy + `listing_date` entry gate
  are gone from them (DQ views unchanged). Downstream views inherit. `inferred_active` no longer phantom-stamps.
- 183 held set resolved-from-real-signal or excluded (counts reported); 8609 + siblings swept.
- Before/after reported at 2026-03 + 2026-06-30 + the asking-cap quartiles (unstuck) + DOM/size/turnover;
  restatement footnoted. Reversible (backups for any data writes); no fabricated dates (held-set dates only
  from real signals, flagged); dia only; ≤12 api/*.js.

## Boundaries / timing
- EXIT/currency-side + held-set entry-resolution-from-real-signals only. Do NOT re-touch the T4c
  `sf_on_market_date` recovery or invent entry dates. `listing_date` stays raw/audit.
- **Timing:** the first Q2 export is ~4 days out and this restates history + touches the core view family —
  if it cannot land cleanly and fully verified before the Q2 export, it is better to HOLD the Q2 export than
  ship a half-applied restatement. Flag to Scott if the gate can't be met in time.
- Reversible throughout; the restatement is intentional (Scott's call) but must be footnoted, not silent.
