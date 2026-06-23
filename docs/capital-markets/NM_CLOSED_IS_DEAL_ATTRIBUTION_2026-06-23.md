# NM attribution from Salesforce "Closed IS" deals — dia + gov (2026-06-23)

Follow-up to the gov + dia NM live-feed attribution work
(`gov_promote_nm_comps` / `dia_promote_nm_comps`). **Standing doctrine (Scott,
2026-06-23): adapt the LCC pipeline to whatever Salesforce already PRODUCES —
never require new Salesforce data entry.** Instead of asking the team to log
"Internal Sold Comps," the pipeline now consumes the data SF already has: the
**Closed-IS deals** in `sf_deal_staging` (refreshed daily). Receipts-first,
grounded live on dia (`zqzrriwuavgrquhisnoa`) and gov (`scknotsqkcheojiaewwh`).

## What shipped

A **third leg** added to both promotion functions (generalized, not forked):
the comp universe is now `live Internal comps ∪ manual export ∪ Closed-IS
deals`, with a `src_kind` threaded through the existing matcher / dedup / create
machinery. Migrations:

- `Dialysis/supabase/migrations/20260623_dia_nm_closed_is_deal_attribution.sql`
- `government-lease/sql/20260623_gov_nm_closed_is_deal_attribution.sql`

Both re-create the function (added 4 trailing observability columns; the daily
cron's positional call is unchanged), applied live + committed.

### Source filter (the gate)
`sf_deal_staging WHERE stage='Closed IS'` (deal_type IS CM / Other). These are
Northmarq-brokered investment-sale **closings** by definition. **Excluded:**
`Terminated IS` (did not close), `Closed Lost`, all `D&E` (financing, not a
sale), and all open-pipeline stages (`Listing Signed`, `In Escrow`,
`LOI Executed`, `Non-refundable`). `expected_close_date` = close; `Deal_Price__c`
= price; `Direct_Co_Broke_sjc__c` = side (same vocabulary as comps);
`Tenant_Names_sjc__c` = operator/agency.

### Matching & dedup (conservative, additive)
- The deal leg is the **lowest-priority** source in the per-sale tiebreak
  (`comp_live > export > closed_is_deal`). A sale already reachable by a
  comp/export keeps its provenance **exactly** — the deal only WINS a sale no
  comp/export reached. **Fully additive; zero regression to the comp/export
  behavior.**
- Distinct, separately-revertable provenance
  `is_northmarq_source='salesforce_closed_is_deal'`. A deal **never relabels a
  non-null source** (`cur_src IS NULL` guard): it only attaches a source to a
  legacy/orphaned NULL-source NM row, or newly attributes a genuinely-uncovered
  closing.
- **De-dup across all three sources** is automatic: a deal + comp + export that
  describe the SAME closing collapse to ONE tagged sale via the best-per-sale
  selection + the `_tag_skip` double-count guard. `match-don't-duplicate`:
  collapse NM-created stubs (keep the CoStar row), never mint a duplicate.
  Create-from-comp only when genuinely absent ($0/null-price guarded).
- Side preserved (Direct(Both)/Co-Broke(Seller) → listing; Co-Broke(Buyer) →
  buyside w/ NM-listing-broker guard; NULL → unsided, preserving an existing
  buyside on dia).

### Latent bug fixed (exposed by the deal leg)
`is_costar = (data_source='costar_sidebar')` was **NULL** when `data_source IS
NULL`, and `ORDER BY is_costar DESC` is NULLS-FIRST — so a null-source candidate
could outrank a CoStar row in the best-per-sale / dedup selection (it would keep
the null row and supersede the CoStar row, violating "keep CoStar price"). Now
`coalesce(...,false)` on both DBs.

## Gate (verified live 2026-06-23)

**dia** — dry-run = real = idempotent (0/0/0 on re-run).
- `deal_universe` 59 (61 Closed-IS − 2 null-price/no-close, surfaced as
  `deal_held_unattributable`); `deal_matched` 8; **`deal_new_attributions` 0.**
- **0 new dollar attributions is the honest, complete answer:** all 9 priced
  recent (2023-25) deals already match an NM-tagged sale; the 10th (Pasadena
  "Other", null price) is held. Recent-year NM does **not** rise — those
  closings were already 100% covered by the export leg. The durable win:
  recent-year attribution now flows from the **live** deal feed (daily), no
  manual re-upload; a NEW closing auto-attributes when SF marks it `Closed IS`.
- Real run: 4 benign source-attaches on already-NM rows (`is_northmarq`
  unchanged) + 4 genuine duplicate collapses (all 2019-2022, keep CoStar).
- **Per-year NM unchanged: 2023=15 / 2024=15 / 2025=18 / 2026=2.** 2026 stays
  honest (0 dia deals are `Closed IS` yet — still escrow/LOI).
- Spot-checks (3 of the matched deals, exact city/price/date): Weslaco TX
  $2,027,027 2023-04-21 → sale 14450 (already NM); Auburn WA $7,120,503
  2025-06-23 → sale 8867 (already NM); LaPlace LA $2,814,612.50 2022 → keeps the
  CoStar twin, supersedes the null-source duplicate. **0 false positives.**

**gov** — dry-run = real = idempotent (0/0/0).
- `deal_universe` 12; `deal_matched` 0; tag_changes 0; dedup 0. The deal leg is
  correctly **inert**: all 14 gov Closed-IS deals are ≤2021 and already
  comp-covered (11/12 priced confirmed NM-covered by city-match, the 12th by
  address; **0 not-covered**). gov recent-year NM already flows from the live
  comp feed (fresh through 2026), so there is nothing for the deal leg to add —
  it provides the same resilience + auto-pickup for future closings. **gov NM
  totals unchanged.**
- Gotcha grounded: gov `Agency_sjc__c` is the listing-agreement type
  ('Exclusive'/'Non-Exclusive'), NOT the agency — `Tenant_Names_sjc__c` is the
  agency used for the `gov_nm_agency_token_overlap` corroborator.

## Boundaries honored
Consume what SF produces; **no SF data-entry / process change required**.
Generalized shared logic across both DBs (not forked). Conservative matching
over coverage. Reversible (per-channel + per-run). No chart code or SF importer
touched. Daily crons unchanged (`dia-nm-comp-promote` 05:40 UTC,
`gov-nm-comp-promote` 05:30 UTC) — new Closed-IS deals attribute automatically.

### Revert (per channel)
```sql
-- dia / gov: undo the Closed-IS deal channel only (comp/export tags untouched)
UPDATE sales_transactions SET is_northmarq=false, is_northmarq_source=NULL,
       is_northmarq_buyside=NULL WHERE is_northmarq_source='salesforce_closed_is_deal';
-- created-from-deal rows (if any): data_source='salesforce_deal'
```
Per-run revert via `dia_nm_comp_promote_log` / `gov_nm_comp_promote_log`
(`run_id`).
