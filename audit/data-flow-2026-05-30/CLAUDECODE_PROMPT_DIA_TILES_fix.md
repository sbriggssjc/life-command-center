# Claude Code — Dia Overview broken-tile fixes (DIA_OVERVIEW_TILE_AUDIT_2026-06-23)

## Why
Phase 2's dia Overview value dashboard renders correctly, but a set of tiles are broken/
misleading. All grounded live: **the data exists**; these are render/fetch bugs (capped-`.length`
headlines that collapse to wrong values on a timed-out/empty fetch, stranded async `setTxt`
fills, and a loader that never assigns). Doctrine: a headline must come from a **server-side
aggregate** (summary view / MV / `count=exact`), never a capped row-fetch `.length` or a fragile
post-render `setTxt` that a re-render can strand. All changes are client `dialysis.js` (no api/*.js
— `ls api/*.js | wc -l` stays 12; no migration). See the audit doc for full grounding.

## Unit 1 — SJC Deal Book: 4 summary tiles stuck "..."
`dialysis.js:1588-1604`. The aggregation from `v_sjc_deal_book_summary` (60 rows) is correct and
the by-year/teams tables (same async block) render — but the 4 value tiles (`sjcClosedVal`/
`sjcVolVal`/`sjcActiveVal`/`sjcUCVal`) are filled once via `setTxt` under the
`window._diaSjcDealBookRendered` guard, so a **re-render after the async fill** rebuilds them to
the `value:'...'` placeholder and the guard skips the refill.
- Fix: make the 4 tiles reflect the data on every render. Either (a) drop/relax the once-guard so
  the async fill re-runs and re-applies on re-render, or (b) cache the computed summary
  (closedDeals/closedVol/activeDeals/ucDeals) and render the tiles from cache inline (not "..."),
  refreshing the cache when the fetch completes. Verify the 4 tiles show real numbers after a
  re-render, not "...".

## Unit 2 — Clinic Financial Estimates: "No financial estimates available"
`renderFinancialMetricsInner` (`dialysis.js:2421-2431`) shows "none" when `diaFinancialEstimates`
is `_empty`/missing `clinics_estimated`. But `v_clinic_financial_overview` returns real data
(clinics_estimated **8,511**, verified via `diaQuery` in-browser). The loader that assigns
`diaFinancialEstimates` is the bug — it never assigns (stays null) or mis-handles the result
shape and sets `_empty`.
- Fix: find the financial loader; assign `diaFinancialEstimates` from `v_clinic_financial_overview`
  row 0, tolerating BOTH `Array.isArray(res)?res[0]` AND `(res.data||[])[0]` shapes (mirror the
  SJC code's `Array.isArray(rows)?rows:(rows.data||[])`). Only set `_empty` on a genuine empty
  result; on fetch error set `_error` (not silent empty). Verify the financial cards populate.

## Unit 3 — Lease Coverage: "100.0% / 0 need backfill" (false + collapses on timeout)
`dialysis.js:929` fetches `v_clinic_lease_backfill_candidates` with `limit:1000` into
`diaData.leaseBackfillRows`; `:1771` `leaseBackfillLen = rows.length`; `:1794`
`leaseBackfillPct = (totalClinics − leaseBackfillLen)/totalClinics`; `:1946` the card. So it caps
at 1000, and on a timed-out/empty fetch len=0 → **100% / 0** (false). It also measures the wrong
thing (% not-in-the-capped-queue, not real lease-data coverage; true coverage ≈ 4,216/12,280 =
34% per Portfolio at a Glance).
- Fix: compute Lease Coverage from a **server-side count**, not the capped `.length`:
  - Prefer the `mv_dia_overview_stats` numbers already loaded (`properties_with_rent` /
    `total_properties`) OR a `count=exact` on the backfill view for the "need backfill" number.
  - Headline = real coverage % (align with Portfolio "with lease rent" so the page is internally
    consistent); sub = the true candidate count (use the un-capped count, e.g. ~3,035 — not the
    1000 cap). NEVER collapse to 100% when the fetch is empty (guard: if the count fetch failed,
    show "—", not 100%).

## Unit 4 — Verification Status headline "0"
The headline `0` is the "due now" count (genuinely 0) and reads as broken.
- Fix (`dialysis.js` ~2353 / the verification card ~4917): headline a meaningful number —
  **overdue (28)** or checks/7d — and move "due now: 0" into the sub-detail.

## Unit 5 — Clickable Recent Closed Sales (+ team closings)
`dialysis.js:1660-1677` renders Recent Closed Sales as static rows. Make each row click through
to the deal/property detail (`openUnifiedDetail('dia', …)` for an LCC-linked sale, else the SF
deal URL). This needs a linkable id on `v_sjc_deal_book` (`property_id` / `sale_id` / SF deal id).
- Fix: if the view already exposes a linkable id, wire `onclick`; if NOT, add the id to the
  `v_sjc_deal_book` select (and the view if needed — dia migration) so the row can link. Keep it
  graceful (no id ⇒ non-clickable row, no error). Same treatment for the team-closing rows is a
  nice-to-have if a team→deals drill exists.

## Boundaries / verify
- Client `dialysis.js` only; no api/*.js (`ls api/*.js | wc -l`=12); no migration unless Unit 5
  needs the linkable id added to `v_sjc_deal_book` (dia DB).
- Robustness rule for all units: a tile headline derives from a server-side aggregate; a
  failed/empty fetch shows "—" or an honest empty state, **never a falsely-perfect number**.
- `node --check dialysis.js`; suite green. Live after redeploy: SJC 4 tiles show numbers;
  financial cards populate; Lease Coverage shows real coverage (~34%, sub ~3,035) and never 100%/0;
  verification headline is meaningful; recent-closed-sale rows click through.

## Out of scope (handled separately)
- **CMS ingestion stalled since 2026-03-27** (drives stale movers/freshness) — ops re-run of the
  DialysisProject pipeline (Scott), not a dia.js fix.
- **742 active listings scope** + **SJC SF-sync completeness** — grounding spot-checks (Cowork).
