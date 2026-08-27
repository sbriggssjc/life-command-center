# Dossier Rent Fix Worklog

## Objective
Fix the 5247 Airways / DaVita lease economics display and source data gap for Dialysis_DB property `23654`, lease `16307`.

## Grounding
- Property: 5247 Airways Blvd, Memphis, TN 38116.
- Lease: annual rent `181959`, building size `6308`, start `2018-06-06`, expiration `2033-06-06`.
- Escalation: `10% every 5 years`, `lease_bump_pct = 0.1`, `lease_bump_interval_mo = 60`.
- Expected year-1 rent/SF: `181959 / 6308 = 28.85`.
- Expected current rent as of 2026: one 2023 escalation, `181959 * 1.10 = 200154.90`, or about `$31.73/SF`.

## Plan
1. Trace the dossier and detail-panel lease renderers.
2. Add compute-on-read rent/SF when the stored lease value is null.
3. Add current-rent-as-of computation from `lease_rent_schedule`, else anchor rent and bump math.
4. Render Year-1 rent + $/SF, Current rent + $/SF, term remaining, and option-bump continuation without fabricating unknown option terms.
5. Add an idempotent Dialysis_DB migration to backfill `leases.rent_per_sf` only when blank and inputs exist.

## Findings
- The stored dossier packet assembler already derives Year-1 rent/SF from `annual_rent / building_size` when inputs are present.
- It did not fetch `lease_rent_schedule` or compute current escalated rent.
- The browser lease tab displayed stored `rent_psf`/metadata only, so a null stored `leases.rent_per_sf` rendered blank.

## Changes
- `api/_handlers/entities-handler.js`
  - Fetches `lease_rent_schedule` for the live lease.
  - Computes Year-1 rent/SF from `annual_rent / building_size` when the stored value is null.
  - Computes Current rent as of the generation date from `lease_rent_schedule` when populated, else `anchor/lease rent × bump math` using `projectRentAtDate`.
  - Adds Derived tags with inputs for current rent and current rent/SF.
  - Emits option bump continuation only when renewal terms explicitly support it; otherwise omitted so the renderer shows "Not on file."
- `api/_shared/dossier-generator.js`
  - Renders `Year-1 rent + $/SF` and `Current rent + $/SF` as paired rows.
  - Preserves two decimals for rent/SF.
  - Adds `Bumps continue through options?`.
- `detail.js`
  - Computes rent/SF in the live Lease tab when stored rent/SF is null.
  - Renders Year-1 and Current paired rent rows.
  - Uses `lease_rent_schedule` first for current rent, then anchor/bump projection.
  - Shows option bump continuation as "Not on file" unless stated in renewal terms.
- `migrations/dialysis_db/20260801_backfill_lease_rent_per_sf.sql`
  - Fill-blanks-only source backfill for `leases.rent_per_sf` from `leases.annual_rent / properties.building_size`.
- Live Dialysis_DB source row:
  - Patched lease `16307` to `rent_per_sf = 28.85` via Supabase REST after sandbox approval.
  - Returned row confirms `annual_rent = 181959`, `rent_per_sf = 28.85`, `renewal_options = "2, 5yr"`, `escalation_raw_text_current = "10% every 5 years"`.

## Verification
- `node --test test\dossier-generator.test.mjs` passes.
- `node --check api\_handlers\entities-handler.js` passes.
- `node --check api\_shared\dossier-generator.js` passes.
- `node --check detail.js` passes.

## Transaction & Marketing Timeline Follow-up (2026-08-01)

### Objective
Wire the 5247 Airways transaction/marketing history from source tables, not `properties.latest_sale_*`:
`sales_transactions` filtered to `transaction_state='live'` plus all relevant `available_listings` rows.

### Grounding
- Dialysis_DB project: `zqzrriwuavgrquhisnoa`.
- Property: `23654`; asset entity `bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0`.
- Expected live sale: `2018-06-01`, DaVita HealthCare Partners -> Kingsbarn Realty, `$3,150,000`,
  stated cap `5.40%`, calculated cap `5.78%`, `firm_term_years_at_sale = 15.0`.
- Expected listing sequence:
  - `2017-07-17` prior listing, Marcus & Millichap / Cook, `$3,137,221`.
  - `2017-12-08` prior listing, SRS / Mousavi, `$3,466,000`.
  - `2024-07-02` active portfolio listing, SRS / Mousavi, Luther, Sullivan, `$27,136,000`, `5.25%`,
    about `$550/SF`, portfolio ask; do not present as the single-asset ask.

### Plan
1. Extend the server packet with a `transaction_marketing_timeline` assembled from live sales and listings.
2. Render the stored dossier section as "Transaction & Marketing Timeline" with cap-at-close, firm term, brokers,
   DOM, price/SF, and portfolio flag.
3. Update the live Deal History tab to read live `sales_transactions` rows and show the same richer timeline.
4. Add focused tests for the dossier renderer and run syntax checks.

### Changes
- `api/_handlers/entities-handler.js`
  - Adds `transaction_marketing_timeline` to the dossier packet.
  - Reads `sales_transactions` with `transaction_state=eq.live`.
  - Reads `available_listings` history and normalizes prior/current ask, cap, broker, DOM, $/SF, and portfolio flag.
  - Detects portfolio listings from explicit fields/text or from the contradiction between portfolio ask and stored
    single-asset $/SF.
- `api/_shared/dossier-generator.js`
  - Replaces the old sale-only section with `Transaction & Marketing Timeline` when timeline data is present.
  - Shows prior listings, live sale cap-at-close/firm-term-at-close, and active listing market metrics.
  - Emits the portfolio warning as grounded/derived, not as a single-asset ask.
- `detail.js`
  - Deal History / Sales cache now fetches live `sales_transactions` directly instead of preferring
    `property_sale_events`.
  - Listing cards show price/SF, cap, DOM, firm/broker fields when present, and portfolio warning.
  - Sale cards show stated cap, calculated cap, and firm term at close.
- `test/dossier-generator.test.mjs`
  - Adds the 23654 listing/sale/listing timeline fixture and assertions for portfolio warning + cap/term display.

### Live Verification
Read-only Supabase REST verification against Dialysis_DB project `zqzrriwuavgrquhisnoa`, property `23654`:
- `sales_transactions`: 3 rows total; states are `duplicate_superseded`, `live`, `duplicate_superseded`.
- Live sale row: sale_id `12284`; `2018-06-01`; seller `DaVita HealthCare Prtnrs`; buyer `Kingsbarn Realty`;
  sold price `$3,150,000`; stated cap `0.054`; calculated cap `0.0578`; firm term at sale
  `15.014...` years, rendered as `15.0`.
- `available_listings`: 3 rows.
  - listing `9228`: `2017-07-17`, sold/off-market, initial/last ask `$3,137,221.04`, broker `M&M; Cook`.
  - listing `9341`: `2017-12-08`, sold/off-market, initial ask `$3,466,000`, last price `$3,137,221.04`,
    broker `SRS; Mousavi`.
  - listing `12449`: `2024-07-02`, active, initial/last ask `$27,136,000`, `$550.57/SF`, cap `0.0524`,
    broker names `Matthew Mousavi, Patrick Luther, Stephen Sullivan`; portfolio flag is derived from
    `$550.57/SF × 6,308 SF = ~$3,472,996`, so `$27.136M` is a portfolio ask, not the property ask.
- Source differences vs. the prompt that should be surfaced, not silently overwritten:
  - Active listing cap stored in the live row is `0.0524` (`5.24%`), not exactly `5.25%`.
  - The active listing row has the three broker names but does not carry an `SRS` firm value in the row fields
    checked; the renderer will not fabricate it.
