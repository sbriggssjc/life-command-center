# Claude Code prompt — T4c Item 3: repoint timing views to the SINGLE canonical date (`on_market_date`)

> The de-surge + the consolidation, together. T4c recovery is COMPLETE (628 held listings dated from real
> `Comp__c.On_Market_Date__c`; verified live). But the Capital-Markets timing/DOM/ramp charts still read
> `listing_date` (the legacy field that held the fake ingest-clock dates), so the recovered dates aren't
> visible yet. This repoints those views at **`on_market_date`** AND establishes it as the **one canonical
> market-entry date** so no future topic can re-introduce the surge by reading the wrong field. Scott's
> directive: "only one place to store this." dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`.
> Hard gate: **published history (≤ 2026-03-31) byte-identical** (`dropped_pub = 0`, no published month
> moves). Reversible (view defs only). No domain-row writes.

## Receipts — `on_market_date` is already the complete canonical field (grounded 2026-06-24)
`available_listings.on_market_date` is populated for everything EXCEPT the held set. `on_market_date_source`:
- **dia:** `unestablished_historical` 1497 (dated, 2001→2026 — pre-2026-04 rows kept at their date for
  published-history parity) · **`unestablished` 1349 (NULL — the held no-comp-link set)** ·
  `synth_sale_minus_median_dom` 1199 · `sale_anchor_est_175` 684 · `sf_on_market_date` 337 (recovered) ·
  `synth_sale_minus_median_dom_clamped_r70d10` 8 · `costar_days_on_market` 2.
- **gov:** `synthetic_from_sale` 1391 · `master_curated` 692 · **`unestablished` 533 (NULL — held)** ·
  `sf_on_market_date` 382 (recovered) · `unestablished_historical` 55.

So the synthetic sales-proxy, the master-curated history, the sale-anchor estimate, the historical
artifact dates, AND the recovered SF dates are ALL already materialized in `on_market_date`. The only
NULLs are the held `unestablished` rows (dia 1349 / gov 533) — the artifact-dated set that surfaces only
at Q2-2026 (no published quarter). **Dropping the NULLs from the timing axis is the de-surge, and because
they touch no published quarter, it leaves published history unchanged.**

## The repoint (the de-surge)
Repoint the dia + gov timing / DOM / inventory-ramp views to use **`on_market_date`** as the market-entry
anchor instead of `listing_date`:
- dia: `cm_dialysis_active_listings_m` / `_q` (the added-per-month + DOM logic).
- gov: `cm_gov_market_turnover_m`, `cm_gov_inventory_backlog_m` (the `eff_start` CTE + added/inventory).
- Rows with `on_market_date IS NULL` (the held `unestablished` set) drop out of the time axis (and DOM =
  NULL for them, as already done). Rows with a date plot at their real month.
- **Do NOT reintroduce a `listing_date` fallback** — that's the whole point (it carries the fake dates).
  `on_market_date` already materializes the synthetic/anchor/historical dates, so no fallback is needed.
- **CARVE-OUT — the point-in-time CURRENT active/available STOCK count ("how many on the market NOW")
  stays on the FRESHNESS GATE** (`last_verified_at` within 12mo + `consecutive_check_failures < 3` +
  active status). Do NOT switch the current-count headline to `on_market_date`. "On the market now" is a
  *currency* question (recency of verification), not an entry-date question — switching would triple it
  (dia 119→403, gov 41→97) by counting recovered HISTORICAL listings that came to market years ago and
  aren't current inventory. `on_market_date` drives the FLOW/timing metrics (new-to-market / added / ramp
  / DOM) and the historical active-over-time span (each listing counted active across
  `on_market_date → off_market_date`) — but the "how many on the market now" number stays freshness-gated.
  The freshness gate already includes any recovered listing that's genuinely still current; the rest are
  historical and belong only in the flow/over-time series, not the current headline.

## The restate gate (Scott's decision: accuracy-first, 2026-06-24)
Scott chose to **RESTATE** — the recovered real dates land at their true historical months even inside the
published window (≤ 2026-03-31), because those ~673 listings (337 dia / 336 gov) were genuinely on-market
then and the old series undercounted them (they carried fake June-2026 ingest dates, so they only ever
showed at Q2-2026). So the gate is **NOT** byte-identical published history. The gate is: **the ONLY
published-window change is the recovered `sf_on_market_date` rows landing at their true months — nothing
else moves.**
- **Isolation check (the blocking gate):** recompute the published window with the `sf_on_market_date`
  rows EXCLUDED, and diff vs the OLD published series — that diff must be **0**. That proves the held-NULL
  de-surge and every other source (`synthetic_from_sale`/`master_curated`/`sale_anchor_est_175`/
  `synth_sale_*`/`unestablished_historical`) are byte-identical, and the ONLY delta is the intentional
  recovered-date restatement. If anything else moves, that's an accidental bug (anchor-offset, dropped
  row) to fix before shipping.
- **Window correctness:** confirm each recovered row carries a valid `off_market_date`/status so it spans
  its true on-market → off-market window in the historical active series and does NOT inflate the CURRENT
  active count as "active since <historical date>." A recovered comp that has since sold must close out at
  its sale/off-market date, not run to today.
- **Restatement footnote:** add a one-time annotation to the affected charts/report — e.g. "historical
  series restated 2026-06-24 to reflect recovered Salesforce on-market dates" — so the change is
  transparent, not silent.

## The consolidation — ONE canonical field (Scott: "only one place to store this")
1. **`on_market_date` is THE authoritative market-entry date.** Every consumer that means "when did this
   come to market" (timing/DOM/ramp/added series, exports, any cap-markets calc) reads `on_market_date` —
   never `listing_date`.
2. **Audit + migrate every current reader of `listing_date`** in the `cm_*` views / export builders /
   calcs. Repoint the market-timing ones to `on_market_date`; report the full list of what was found and
   changed (so we know there's no second source of truth left).
3. **`listing_date` becomes raw-capture / audit-only — keep it, don't drop it.** It's the reversibility
   anchor (the recovery is reversible precisely because `listing_date` was never overwritten). Make the
   contract unmistakable: `COMMENT ON COLUMN available_listings.on_market_date` = 'AUTHORITATIVE
   market-entry date — read this for all timing/DOM/added/ramp; NULL = unknown, exclude from time series'
   and `COMMENT ON COLUMN available_listings.listing_date` = 'RAW capture date (may be ingest-clock/fake)
   — audit/reversibility only; do NOT use for market timing'. Add the same contract to the LCC `CLAUDE.md`
   so future topics (T2/T7/T8…) can't reintroduce the surge by reading the wrong field.
4. Going forward the ingest already writes `on_market_date` via the provenance ladder (Item 1 killed the
   silent `listing_date = created_at` default) — confirm no writer still treats `listing_date` as the
   market date.

## Gate (verify live, both DBs)
- dia + gov timing/DOM/ramp views read `on_market_date`; the held NULL set (dia 1349 / gov 533) is excluded
  → the **Q2-2026 step is gone** and the recovered rows plot at their real months (2014→2026, de-clustered).
- **Restate gate:** the published window changes ONLY by the recovered `sf_on_market_date` rows at their
  true months — the isolation check (published series recomputed with those rows excluded) is byte-identical
  to the old series; recovered rows span the correct on-market→off-market window (no current-active
  inflation); the restatement is footnoted. Do not ship if any NON-recovered row moves a published month.
- No `cm_*` view / export still keys market timing off `listing_date`; the audit list is reported;
  the column COMMENTs + CLAUDE.md contract are in place.
- `synthetic_from_sale` / `master_curated` still contribute their (materialized) dates — not dropped.
- Reversible (revert the view defs); no domain-row writes; ≤12 api/*.js.

## Boundaries
View/export config + column documentation only — no row writes, no new date fabrication, `listing_date`
retained as raw-capture/audit. `on_market_date` is the single source of truth for market timing. The hard
gate is byte-identical published history; the visible change is confined to Q2-2026 forward (the de-surge).
After this ships + gates, regenerate a fresh export and confirm the cap-markets "available/added/DOM"
charts read the corrected market-entry dates.
