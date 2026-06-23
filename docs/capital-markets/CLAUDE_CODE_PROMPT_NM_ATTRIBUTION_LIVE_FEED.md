# Claude Code prompt — wire NM attribution to the LIVE Salesforce feed (not the manual snapshot)

> Follow-up to the NM-attribution fix (`gov_promote_nm_comps`, PR #304). Scott flagged that there HAVE
> been Northmarq gov sales in 2026 but the report shows 0 — and that the system depends on one-time
> manual deal uploads. Grounded live on gov `scknotsqkcheojiaewwh` 2026-06-23 — he's right. The prior
> fix tags off a **static** table; the live SF feed already has the 2026 deals and isn't being used.
> Receipts-first; conservative matching; reversible; ongoing (not another snapshot).

## Receipts (live, 2026-06-23)
The current `gov_promote_nm_comps` reads **`sf_internal_comp_export`** — a **manual snapshot frozen at
sold_date 2025-12-29** (newest row), 127 rows, no 2026 deals. So 2026 NM = 0.

But the **live** `sf_comp_staging` (`source_system='salesforce'`, updated through **2026-06-23**) already
holds the 2026 NM gov sales — **8 rows (≈6 distinct)**, all `linked_to_sale=false`, none tagged
`is_northmarq`:

| Deal (comp_name) | sold_date | sold_price |
|---|---|---|
| SSA — Blytheville, AR | 2026-02-20 | $1,150,000 |
| USPS — Milwaukee, WI | 2026-03-03 | $8,500,000 *(dup row)* |
| AL Dept of Human Resources — Jasper, AL | 2026-03-11 | $1,850,000 |
| SSA — Mount Pleasant, MI | 2026-05-06 | $1,300,000 |
| VA — Yukon, OK | 2026-05-20 | $0 *(missing price; dup row)* |
| TX DFPS — Wharton, TX | 2026-06-05 | $515,000 |

Live SF comp coverage by sold-year (`source_system='salesforce'`): **2024=9, 2025=5, 2026=8**. The
ongoing SF discovery WORKS — the attribution just reads the wrong (static) table.

## Root cause
`gov_promote_nm_comps` was built off `sf_internal_comp_export` (the one-time manual export). The live
Salesforce comp feed (`sf_comp_staging`, source `salesforce`) is refreshed daily but is **not the
attribution source**, so any deal closed after the last manual upload (everything in 2026) is invisible
to the NM tagging. This is propagation by a stale source, exactly as Scott described.

## The ask

1. **Make the live `sf_comp_staging` (source `salesforce`) the PRIMARY NM-attribution source**, with
   `sf_internal_comp_export` demoted to a historical backfill supplement. Update `gov_promote_nm_comps`
   (and its daily cron) to read the live feed so newly-synced NM deals attribute automatically.
   - **NM-vs-market rule (CONFIRMED with Scott 2026-06-23): attribute ONLY `raw_row->>'Comp_Type__c'
     = 'Internal'`.** `External`/`Source='Manual'` rows are market comps NM logs for reference and must
     NOT be tagged (verified: SSA-Blytheville, Jasper, Mt-Pleasant, VA-Yukon are correctly External and
     are NOT NM deals). The side field (`Direct_Co_Broke__c`) is a fallback only when `Comp_Type__c` is
     absent — never an override of an `External` flag.

2. **Match the live Internal comps to an EXISTING `sales_transactions` row and TAG it — never mint a
   duplicate.** (Receipt: Fort Wayne, IN 2025-12-29 is split — the NM comp created/tagged an $8.0M row
   while the real CoStar sale ($8.512M) sits untagged. USPS-Milwaukee 2026-03-26 is two null-price rows
   and untagged.) The matcher must prefer the existing CoStar sale (state + sold_date ±~45d + address/
   city + agency), tag THAT row `is_northmarq`, and **dedup the already-split pairs** (collapse the
   NM-comp row into the CoStar row, keep the recorded CoStar price, carry the NM flag). Dedup the
   staging too (USPS-Milwaukee, VA-Yukon each appear twice). One deal → one tagged sale.
   - **Price authority:** when an NM comp and a CoStar sale are the same deal with different prices
     (Fort Wayne $8.0M vs $8.512M), keep the **CoStar recorded price** as the sale figure (the NM-comp
     value is often rounded) but carry the NM flag. Flag a >5% divergence for review, don't silently pick.

3. **Create-from-comp ONLY when genuinely absent.** Wharton, TX 2026-06-05 is in the SF feed but NOT
   in `sales_transactions` at all → create it from the SF comp (data_source=SF, `is_northmarq=true`),
   GATED + reported. **Guard `$0`/null price** (VA-Yukon, the null-price Milwaukee rows) — never write a
   $0 sale; hold with a reason. Confirm a match doesn't exist before creating (avoid re-introducing the
   duplicate problem from #2).

4. **Recover the 46 NULL-sold_date Internal NM comps.** 46 Internal NM gov comps in the live feed have
   no `sold_date`, so they're invisible to every date-based chart. Backfill the date from the linked SF
   deal / CoStar sale where resolvable; surface the rest as a "needs date" review bucket. Report the count.

5. **Keep it ongoing.** The daily cron already exists — ensure it consumes the live feed so this doesn't
   re-freeze. No new manual upload should be required for a new NM gov sale to appear.

## Gate (verify live before done)
- 2026 NM gov sales reflect the **3 Internal** 2026 comps (USPS-Milwaukee + Wharton + the third),
  not 0 — and ONLY Internal (the 4 External deals stay untagged); `is_northmarq_source` populated.
- **No duplicates:** Fort Wayne resolves to ONE tagged sale at the CoStar price (not $8.0M + $8.512M);
  USPS-Milwaukee is one tagged sale, not two null-price rows.
- Wharton exists as one created sale, tagged. VA-Yukon / null-price rows are held (no $0 sale written).
- The 46 null-sold_date Internal comps are reported (backfilled where resolvable).
- Spot-check Scott's named deals (Pinehurst, Fort Wayne, USPS-Milwaukee, Wharton) each = exactly one
  tagged sale, correct price/date — 0 false positives, 0 duplicates.
- Idempotent re-run = 0 further changes. Reversible via the promote log + distinct source tag.
- Confirm a hypothetical new Internal SF comp (synced tomorrow) attributes on the next cron tick with
  no manual load.

## Boundaries
Don't touch the SF importer (it works — the feed is current to 6/23) or the chart code. Conservative
matching over coverage. The `$0`/dup rows are data-quality holds, not silent writes. Reversible.
