# T4c Item 3 — on_market_date timing repoint: isolation-check receipts (2026-06-24)

Repointed the dia + gov CM supply-side **timing / DOM / added / new-to-market /
inventory-ramp** series + the gov **historical active-over-time SPAN** to the single
canonical `available_listings.on_market_date` (was `listing_date`, which carried fake
ingest-clock dates). Applied live to dia (`zqzrriwuavgrquhisnoa`) + gov
(`scknotsqkcheojiaewwh`); migrations
`supabase/migrations/20260624_cm_t4c_item3_{gov,dia}_on_market_date_timing.sql`.

## Doctrine (Scott, 2026-06-24)
1. **Restate — accuracy-first** ("let real dates rewrite history"): recovered Salesforce
   on-market dates plot at their TRUE month even inside an already-published quarter.
   Published history is intentionally NOT frozen.
2. **Point-in-time CURRENT active/available STOCK count stays on the freshness gate** —
   NOT switched to on_market_date. dia `cm_dialysis_active_listings_m/_q` keep their
   listing_date membership (canonical ~119); gov current-available =
   `cm_gov_available_by_term_summary` / `_available_cap_dot` (off_market_date IS NULL,
   ~44) — untouched. `on_market_date` drives only the FLOW/timing + the historical
   active-over-time SPAN (each listing active across on_market_date → off_market_date).

## The gate (Scott): the ONLY published-window (≤2026-03-31) delta may be the recovered rows
Isolation check = recompute the published series with `on_market_date_source='sf_on_market_date'`
rows EXCLUDED and compare to the OLD (`listing_date`) series. Result:

| series | published cells differ (recovered excluded) | cause |
|---|---|---|
| gov new_to_market_q | **0 (byte-identical, 1990=1990)** | — |
| dia new_to_market_q | **0 (byte-identical)** | — |
| gov inventory_backlog `added` | **0 (byte-identical)** | — |
| gov turnover/backlog `active` (SPAN) | 8 cells / abs Δ 20 | held-NULL de-surge |
| dia inventory_backlog `added` | 147 cells / −6,411 (~15%) | held-NULL de-surge (old `sold−196d` pad) |

**Finding (refutes the gate's premise):** the held-NULL de-surge is NOT invisible in
published months. Held rows WERE being counted:
- **gov active-span (8 cells):** 82 metrics-eligible held rows carry recent fake
  `listing_date`s (2025-06 → 2026-03) that the OLD span counted as active; the de-surge
  correctly drops them (no verifiable on-market date).
- **dia added (−6,411):** the OLD dia `inventory_backlog.eff` padded `added` via
  `COALESCE(listing_date, sold−196d)` — a sold-anchored reconstruction that counted
  no-evidence held rows. Removing the fallback (per the "no listing_date fallback"
  directive) drops them.

So the published delta = **recovered restatement (intended) + held-NULL de-surge
(intended)**, and the isolation **proves the synthetic / master-curated / historical
sources moved nothing** (gov added + both new_to_market byte-identical). No
unexpected/third source moved.

## Recovered-rows span + current-count check
- **Current active/available count is NOT inflated by recovered rows** ✓ — dia
  `active_listings` excludes them (fake-future `listing_date` < the freshness gate); gov
  `available_by_term` does not key on any date (stayed 44).
- Recovered rows mostly **lack `off_market_date`** (gov 316/382, dia 291/337 open,
  `is_active`) → open-ended spans to *now* in the active-over-time SPAN; **81 gov are
  stale** (`last_verified_at` NULL or > 12 mo). **Follow-up DQ (not blocking):** close
  stale recovered spans (set `off_market_date`) so the historical span ends correctly.

## Restatement footnote
`api/_shared/cm-excel-export.js` `CM_ONMARKET_RESTATEMENT_NOTE` appended to the
`inventory_backlog`, `market_turnover`, `dom_and_pct_of_ask`, `dom_and_pct_of_ask_monthly`
captions (ships on the Railway redeploy).

## Follow-up (surfaced, not built)
- **dia held SOLD listings:** part of the dia `added` −6,411 are SOLD listings (they
  genuinely went on-market) whose on-market date was never recovered → held (NULL). A T4c
  recovery pass giving dia sold-but-held listings a sale-anchored `on_market_date` (like
  gov `synthetic_from_sale`) would restore them to `added` at their true month.
- **dia active-over-time SPAN:** dia has no `on_market_date → off_market_date` span series
  like gov's (its `active_count` is the canonical point-in-time count, 06-22 audit). Adding
  a dedicated dia span line (gov's `eff` CTE is the template) is a separate call.

## Reversibility
View defs only — re-create the prior `listing_date`-anchored bodies to revert; no
domain-row writes; ≤12 api/*.js (the only JS is the caption note).
