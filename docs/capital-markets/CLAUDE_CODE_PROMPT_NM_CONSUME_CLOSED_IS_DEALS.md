# Claude Code prompt — consume Salesforce "Closed IS" deals for NM attribution (adapt to SF, both DBs)

> Follow-up to the gov + dia NM-attribution work. **Standing doctrine (Scott, 2026-06-23): adapt the
> LCC pipeline to whatever Salesforce already produces — never require new Salesforce data entry.**
> Northmarq does not control the org's SF requirements; SF is a required tool used only to the extent
> it yields value. So instead of asking the team to log "Internal Sold Comps," the pipeline must
> consume the data SF already has: the **Closed-IS deals in `sf_deal_staging`**. Grounded live on dia
> `zqzrriwuavgrquhisnoa` (and apply the same to gov `scknotsqkcheojiaewwh`). Receipts-first; the same
> conservative match-don't-duplicate guards as `gov_promote_nm_comps` / `dia_promote_nm_comps`.

## Receipts (dia, live 2026-06-23)
`sf_deal_staging` by stage / deal_type — the NM closings the comp-based pipeline misses:

| stage | deal_type | n | 2023+ | close-date span | notes |
|---|---|---|---|---|---|
| **Closed IS** | IS CM | 60 | 10 | 2017-06 … 2025-12-19 | **NM brokered investment-sale CLOSINGS → attribute** |
| Closed IS | Other | 1 | 1 | 2025-12-04 | also a closing |
| Terminated IS | IS CM | 55 | 46 | — | did NOT close → exclude |
| Final / Closed Lost | D&E | 22 | 0 | — | Debt & Equity financings → exclude (not a sale) |
| Listing Signed / In Escrow / LOI / Non-refundable | IS CM | 11 | 11 | 2026+ | pipeline, NOT yet closed → exclude (this is why 2026 is thin) |

Only **5 of 61** Closed-IS deals carry `linked_property_id`, so matching is mostly by address/city.

## The ask — make `sf_deal_staging` Closed-IS a first-class NM-attribution source (dia AND gov)
Extend `dia_promote_nm_comps` and `gov_promote_nm_comps` (generalize the shared logic) to add a third
input alongside the live Internal comps + the manual export:

1. **Source filter:** `sf_deal_staging` WHERE `stage='Closed IS'` (any `deal_type` in the IS family —
   `IS CM`, `Other`). These are Northmarq-brokered investment-sale closings by definition (it's NM's
   own CRM pipeline). **Exclude** `Terminated IS`, `Closed Lost`, all D&E (financing, not sales), and
   all open-pipeline stages (`Listing Signed`, `In Escrow`, `LOI Executed`, `Non-refundable`).
   - Use `expected_close_date` as the close date; `deal_price`/`deal_cap_rate`,
     `seller_company_name`/`buyer_company_name`, `property_*` for matching.
2. **Match to `sales_transactions`** with the existing conservative matcher (state + close-date ±tol +
   price ±% + city/operator-token), **match-don't-duplicate** (tag the existing CoStar sale, collapse
   stubs via the DB's dedup convention), **create-from-comp only when genuinely absent** ($0/null-price
   guarded), distinct `is_northmarq_source` (e.g. `salesforce_closed_is_deal`), reversible via the
   promote log. Preserve any existing buy/sell-side attribution (the dia sideless-flip guard).
3. **De-dup across all three sources** — Internal Sold Comp, Closed-IS Deal, and manual export can
   describe the SAME closing (they share `sf_property_id`/`sf_deal_id`/address). Collapse to one tagged
   sale before counting; one deal → one NM-tagged sale.
4. **Keep it on the daily cron** so new Closed-IS deals attribute automatically as SF marks deals
   closed — no manual re-upload, no new SF data-entry requirement.

## Gate (verify live)
- dia recent-year NM rises as the ~10-11 Closed-IS 2023-2025 deals attribute (currently 2023=15 /
  2024=15 / 2025=18 unchanged by the comp-only fix); gov re-verified unchanged-or-improved.
- No duplicates (a deal in two sources tags one sale); no terminated/escrow/D&E deal ever tagged.
- 2026 stays honest — dia 2026 closings aren't in `Closed IS` yet (still escrow/LOI), so don't force
  them; they'll attribute when SF marks them closed.
- Idempotent re-run = 0 changes; reversible. Spot-check 3 newly-tagged Closed-IS deals = exact
  city/price/date match, 0 false positives.

## Boundaries / doctrine
**Do not propose or require any Salesforce data-entry or process change** — the whole point is to
consume what SF already produces. Generalize the shared promotion logic across both DBs rather than
forking. Conservative matching over coverage. Reversible. Don't touch chart code or the SF importer.
