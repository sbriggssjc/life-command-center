# LISTING-SALE-PARITY1: dia and gov listing↔sale reconciliation (2026-09-24/25)

Scott, 2026-09-24: gov Available showed properties that had sold. Wanted: the same listing/sale
mechanisms in dia and gov, and nothing counted twice. Everything below was measured live.
Every write is logged and reversible.

## 1. Root cause

- **Gov never closed a listing on a sale.** `close_listing_on_sale` (on `sales_transactions`) and
  `pse_close_listing_on_sale` (on `property_sale_events`) both matched `listing_status = 'Active'`.
  The column holds a lowercase vocabulary enforced by a CHECK (`active` ×482), so neither trigger
  ever fired. They also closed only one listing (`LIMIT 1`) and never set `sale_transaction_id`.
  0 of 482 active gov listings had one.
- **Neither DB handled the reverse case**, where a listing is created or re-seen after the property
  already sold. The Pipkin shape: an OM captured today for a deal that closed in June.
- **Dia's own four closers disagreed with each other:**
  - `close_listing_on_sale` closed any open listing whose `on_market_date` was NULL. A historical
    sale inserted today therefore closed a current re-listing.
  - `fn_listing_close_if_sold` treated a stale 2017 SF on-market date on a 2026 OM as the market
    entry, and closed the listing against a 2021 sale.
  - `fn_sale_event_mark_listings_sold` had no market-sale guard.
  - The hygiene sweep closed any active listing when *any* sale postdated `listing_date`.
- **The gov hygiene sweep ranked listings wrong.** Its listing-dup ranking tested `'Active'` too,
  so it ranked a superseded row above the active one.
- **A latent gov abort, found by the backfill.** Linking a sale fires
  `gov_listing_propagate_to_sale`, which copied a 0.0007 asking cap into the sale. That tripped
  `chk_initial_cap_rate_range` and aborted the whole write. The copy is now range-guarded and
  fail-soft.

## 2. The design: one judgement, one writer, both DBs

`lcc_listing_sale_verdict(on_market_date, on_market_conf, capture_date, asking, sale_date,
sold_price, sale_is_market)` is pure and **byte-identical on both DBs**. The live
`md5(pg_get_functiondef)` is `665d1e5f…` on both. The source block is pinned by md5 `3fef3398…`
in both repos' tests, which run the same fixture (`listing_sale_verdict_cases.json`).

Inputs are normalized before the rules run:
- A market sale is `transaction_state = 'live'` and not `exclude_from_market_metrics`.
- A real market entry is an on-market date with high or medium confidence, no more than 730 days
  before capture. Anything older belongs to an earlier listing cycle.
- Sale dates are compared by month, because the dominant source truncates them to day 1.
- `r` = asking price ÷ sold price.

Rules are checked in this order:

| rule | verdict |
|---|---|
| real entry more than 90 days after the sale | `keep_relisted_after_sale` (dia's 90-day grace) |
| sale on or after capture, or on or after the real entry | close, unless `r` is outside 0.5–2 (then review) |
| sale 0–90 days before the real entry | close if `r` is 0.7–1.3, else review |
| no real entry; sale ≤ 365 days before capture and `r` is 0.85–1.15 | close (the sold deal's OM) |
| sale ≤ 730 days before capture | review |
| same price (±0.5%) and sale ≤ 4 years before capture | review |
| otherwise | `keep_prior_sale` |

Other components:
- **Capture date:** gov uses `first_seen_at`. Dia has no reliable first-seen stamp (`created_at`
  is set on 2 of 5,515 rows), so it uses the earliest of `last_seen`, a capture-fallback
  `listing_date`, and `created_at`.
- **Twins:** a different property at the same state, normalized address and civic number
  (the GOV-AVAIL1 civic guard). A twin's sale goes to **review only**, never close: condo and
  suite sales share an address (7840 Madison Ave sells suites for ~$100k).
- **Writers:** `<dom>_reconcile_listing_sales(property_ids, dry_run, batch)` closes **all** open
  listings, links `sale_transaction_id` (never for a twin), and logs the prior state to
  `<dom>_listing_sale_close_log`. `<dom>_restore_listing_sale_close(batch)` undoes a batch, and a
  restored or rejected pair is never re-closed.
- **Review queue:** ambiguous cases go to `<dom>_listing_sale_review`.
- **Triggers:** the sale trigger, the sale-event trigger and the listing BEFORE trigger all call the
  same verdict.
- **Daily guard:** `<dom>_check_listing_sale_parity()`, scheduled on each DB (dia 04:37, gov 04:41).
  It raises `lcc_health_alerts('listing_sold_still_active')` when the count is above 0 and resolves
  it at 0. It is read-only.
- **Stale listings:** `<dom>_route_stale_listings_to_verification` moves listings not seen in
  180 days, or on market more than 2 years, into the existing `verification_due_at` lane, with
  priority high.

## 3. Parity matrix (live definitions, before → after)

| mechanism | dia before | gov before | both after |
|---|---|---|---|
| sale → close listings | `close_listing_on_sale`: all open, NULL on-market = close, 90-day grace, links sale | `close_listing_on_sale`: matches `'Active'` (**dead**), `LIMIT 1`, no link | the same verdict via `<dom>_reconcile_listing_sales`; all open; links |
| sale event → close | `fn_sale_event_mark_listings_sold`: no market guard | `pse_close_listing_on_sale`: `'Active'` (**dead**) | reconcile for the property (events propagate to the spine) |
| listing created/re-seen → close if sold | `fn_listing_close_if_sold`: any sale ≥ COALESCE(on_market, listing_date) | **absent** | the verdict (captures after the sale; stale entry dates ignored) |
| status vocabulary | `chk_dia_listing_status_vocab` + `zzz_normalize_listing_status` | `chk_gov_listing_status_vocab` + `zzz_normalize_listing_status` | unchanged: already the same 7 lowercase values |
| one active per property | unique index `available_listings_one_active_per_property` | trigger `gov_supersede_prior_active_listing` + unique (property, source, status, date) | unchanged; the gov writer supersedes on that unique collision |
| hygiene sweep listing step | closes on any sale after `listing_date` | ranks by `'Active'` (**wrong**) | dia calls the writer; gov ranking fixed |
| consolidation | `dia_consolidate_property_listings`, `_by_transaction`, cron `dia-auto-consolidate-listings` (*/30) | absent | **not ported**: gov's supersede trigger already keeps one active per property, and gov now links `sale_transaction_id`. Porting `_by_transaction` becomes worthwhile once gov has linked sold rows to collapse (backlog `LISTING-SALE-PARITY1-gov-consolidate`) |
| active-listings snapshot | `cm_capture_active_listings_snapshot` (cron 02:00) | absent | **not ported**: it feeds the dia CM on-market history. Gov's CM reads `v_gov_on_market` live. A gov snapshot is a CM feature decision, not a reconciliation one |
| listing → sale propagation | none | `gov_listing_propagate_to_sale` (could abort) | gov fail-soft + cap range guard |
| verification lane | `lcc_record_listing_check` + `verification_due_at` | same | same; stale listings routed in |
| review queue / guard | none | none | `<dom>_listing_sale_review`, `<dom>_check_listing_sale_parity` + cron |
| LCC side | intake/sidebar writers insert listings directly into the domain DB | same | no JS change: the DB triggers cover every writer, including the frozen Vercel build and the extension |

## 4. Backfill results

**gov** (batch `listing_sale_parity1_backfill_20260924`):

| class | n | listings |
|---|---|---|
| close: sold after we saw it | 4 | Muskogee 16099, Novi 16291, Glendora 16488, Pharr 33352 |
| close: sold after real entry | 1 | Angleton 12946 (superseded as a duplicate of an already-sold row) |
| close: same deal near entry | 1 | San Angelo 269 (ask = sold $2,653,000) |
| close: OM captured after sale | 3 | **Lakeland 31007 (Pipkin)**, Kennewick 16411, Ahoskie 8885 |
| review: sold before capture | 5 | Casa Grande 905, Albemarle 8823, Tulelake 16268, **Fair Oaks 16506**, Eden 30949 |
| review: sold near entry, price off | 1 | Florence 31529 ($347k sale vs $2.8M ask) |
| review: twin | 1 | Chicago Heights 5648 |

Stale listings routed to verification (batch `listing_sale_parity1_stale_20260924`): 144 on market
more than 2 years, 16 not seen in 180 days.

Cross-domain doubles quarantined (batch `listing_sale_parity1_xdomain_20260925`,
`gov_avail1_restore_listing_quarantine`): Long Beach 16531, Fairborn 40089.

Before → after: gov active **482 → 471** (+11 under contract unchanged); `v_gov_on_market`
**333 → 322**; guard 0.

**dia** (same batch names):

| class | n | listings |
|---|---|---|
| close: OM captured after sale | 2 | Jeffersonville 36370 (ask = sold), New Iberia 26039 |
| review: sold before capture | 5 | West Point 26865, San Francisco 51216, Oviedo 30514, Houston 23313, Pauls Valley 23483 |
| review: same price | 2 | Hillsboro 35612, Henderson 27126 |
| review: twin | 1 | Warner Robins 25133 |

Stale listings routed: 65 on market more than 2 years. Before → after: dia active **441 → 439**.
`v_dia_on_market` stays 160 because it reads the quarterly CM snapshot, not live state.

**Named properties Scott or Cowork raised:**
- **Lakeland (Pipkin): closed.**
- **Fair Oaks: review.** It sells suites; the listing has no price.
- **Madison WV 15747: kept.** CoStar days-on-market gives it a real 2026-03-24 entry, four years
  after the 2022 sale. That makes it a re-listing.
- **Long Beach: quarantined from gov.** It's a DaVita building; dia owns it.
- **Casa Grande: review.** Sold 2024 for $2.6M, now asking $7.4M.
- **Florence: review.**

## 5. Cross-domain double count

4 buildings were open in both Available tabs (civic + street + state, 484 gov / 439 dia listings).
The rule applied is `sidebar-pipeline classifyAllApplicableDomains`: a building belongs to every
domain whose tenant it has.

| building | tenants | outcome |
|---|---|---|
| 4223 E Anaheim St, Long Beach | DaVita | dia owns; gov copy quarantined |
| 1200-1288 N Broad St, Fairborn | DaVita + Dollar General | dia owns; gov copy quarantined |
| 1843 Foreman Dr, Cookeville | DaVita + Army Corps | both, by design |
| 1403-1431 Business Center Ct, Dayton | vacant medical office | neither; left for Scott |

## 6. "Should be sold": another source says sold, `sales_transactions` doesn't

No guarded writer promotes a general market comp into `sales_transactions`. The only sale writer
that reads `sf_comp_staging` is `gov_promote_nm_comps`, scoped to Northmarq-internal comps. These
listings are therefore listed, not promoted (backlog `LISTING-SALE-PARITY1-sf-promoter`):

| DB | property | evidence |
|---|---|---|
| gov | Walla Walla 23342 | SF sold 2026-07-20, $2.0M |
| gov | Savannah 16265 | SF 2026-06-23, $19.7M |
| gov | Moses Lake 16412 | SF 2026-06-15, $7.2M |
| gov | Jasper AL 16236 | SF 2026-03-11, $1.85M |
| gov | Marathon FL 3741 | sidebar 2026-05-15, $770k |
| gov | Asbury Park 16239 | a sale row exists but is excluded (owner-user); the listing was still re-seen 2026-09-24 |
| dia | 25570 | SF 2026-08-06, $3.18M |
| dia | Manchester 28981 | SF and sidebar 2026-03-06, $2.2M = ask |
| dia | Bronx 35803 | sidebar 2025-07-16, $4.3M |
| dia | Durham 27823 | sidebar 2026-07-29, owner-user |
| dia | Kissimmee 37696 | sidebar 2026-08-10, $4.1M |

## 7. Tests

- gov `tests/unit/test_listing_sale_parity1.py`: 38 pass, 11 mutations red.
- LCC `test/listing-sale-parity1.test.mjs`: 21 pass, 9 mutations red.

Both apply the real migration file to a throwaway Postgres.
