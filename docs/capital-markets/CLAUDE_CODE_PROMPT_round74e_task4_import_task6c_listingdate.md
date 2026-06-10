# Claude Code prompt — Round 74e: the two remaining R74 gated slices (Task 4 import + Task 6c listing_date)

> The SF-authoritative `is_northmarq` de-contamination is complete and verified
> on both verticals (dia 366, gov 129). Two gated slices remain. They're
> independent — gate each separately. Both: dry-run plan JSON → Scott's
> verification → commit. After these, only the merge → Railway redeploy →
> fresh-export verification closeout is left.

---

## TASK 4 — import the genuinely-missing NM deals (Internal-Sold comps that match no DB sale)

The authoritative NM universe is `public.sf_internal_comp_export` (dia
`zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`). Most `status='Sold'` Internal
comps fingerprint-matched a `sales_transactions` row during R74c/d. The ones that
matched **nothing** are NM deals missing from our DB — import candidates.

**Phase 1 — scope (dry-run, no writes).** Per vertical, list the Internal-Sold
comps with **no** `sales_transactions` match (state + `sold_date` ±120d +
`sold_price` ±6%, ≤25mi proximity + city/tenant confirm — the established gate,
all-comps not 1:1). For each: `sf_comp_id`, comp_name, tenant, city/state, sold
price, sold cap, sold date, listing side (`Direct_Co_Broke__c`). **Report the
count + total $ volume** so Scott can scope before any insert.

**Pre-filter — exclude non-single-asset / non-comp rows** (do NOT import):
referral / advisory / fee / equity-placement / portfolio rows. Markers seen in
`comp_name`: `(Referral)`, `Outside Fee`, `(Equity Placement)`, `Portfolio of N`,
student-housing, and any row with null `sold_price`. Report these separately as
"excluded, not single-asset comps."

**Phase 2 — gated import** (after Scott OKs the Phase-1 count). Pattern = the 7d
importer with its guards: property attach-or-create (USPS-normalized address +
state, geocode proximity; attach to the canonical member of any duplicate
cluster, never create into a cluster), then `sales_transactions` insert with
sold price/cap/date, `is_northmarq` per side (`Direct (Both)`/`Co-Broke (Seller)`
→ true; `Co-Broke (Buyer)` → `is_northmarq_buyside`), `is_northmarq_source=
'salesforce_comp'`, `data_source='sf_internal_comp_r74e'`, idempotent on
`sf_comp_id`. Cap-of-record / triggers fire as designed — assert the side-effects.

**Acceptance:** per-vertical inserts, new NM cap-by-period n, and confirm the #20
listing median doesn't move materially (new comps are NM-listed at the curated
basis, so it should stay ≈ 6.40% dia). No double-counting (the match class is 0
inserts by construction).

---

## TASK 6c — dia listing_date backfill (the active-count over-stamp wall) + stop the writer

~222 dia `available_listings` rows have **NULL `listing_date` + a FUTURE
`off_market_date`** — the availability-checker over-stamp artifact that inflated
the #9 active count (the 196-day synthetic eff_start passed every gate). The #9
fix excluded them; this backfills real dates so they count honestly.

**Phase A — root-cause + STOP the writer (do this first).** Find the path
stamping a future `off_market_date` onto undated rows — check the
availability-checker Edge function, `lcc-auto-scrape-listings`, and
`lcc_record_listing_check`. Fix it so undated rows never get a future off-market
stamp. Without this, the backfill re-accumulates. Document the writer + the fix.

**Phase B — backfill `listing_date` (dry-run → gate → commit).** Evidence ladder
per row: (1) availability-checker page markers / `last_checked` / raw capture
date; (2) CoStar capture date; (3) sale-anchor: `sale_date − median DOM`
(dia ≈ 196d) where the listing links a sale. Tag `listing_date_source`
accordingly. Never fabricate beyond the ladder; if a row has no evidence, leave
it null + exclude (don't guess).

**Acceptance:** re-verify `cm_dialysis_market_turnover_m` — recent quarter-end
active inventory should rise toward Scott's ~130 expectation on REAL dates (not
the inflated or the over-corrected floor). Before/after active count at the
recent anchors. Audit gov for the same NULL-date + future-off_market pattern;
report whether it exists there.

---

## Guardrails (both tasks)

- Dry-run plan JSON first → Scott's independent verification → commit. Idempotent.
- Task 4 writes properties + sales (heavier) — Phase-1 scope before any insert.
- Task 6c writes are date columns on existing listings + the writer fix.
- Provenance-tag everything; no silent overwrites of curated data.
