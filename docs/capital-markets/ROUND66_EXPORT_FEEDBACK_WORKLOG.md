# Capital Markets — Round 66 Export Feedback Worklog

**Date:** 2026-05-31
**Source:** "Capital Markets Export Notes.docx" (dialysis + government) against
`NM-CapMarkets-Dialysis-2026-03-31.xlsx` / `NM-CapMarkets-GovLeased-2026-03-31.xlsx`.

This round addresses the full notes batch: chart y-axis rescaling, data/formula
fixes, the cost-of-capital spread question, and the Bid_Ask style note.

All view fixes were **validated read-only** against the live databases before
inclusion (each view body was executed as a SELECT; column lists were checked
against the existing views; numbers confirmed sane). **No DDL was applied to any
database** — the SQL ships as migrations for review + deploy. No `/api/*.js`
functions were added, so the Vercel 12-function cap is unaffected.

---

## 0. Deployment status

- **2026-05-31 — view migrations APPLIED to production** (both atomically, verified
  post-apply): `20260693` → Dialysis_DB (`zqzrriwuavgrquhisnoa`), `20260694` →
  government (`scknotsqkcheojiaewwh`). The data side of round-66 is live. Because
  every statement is `CREATE OR REPLACE VIEW`, re-running these files through the
  normal repo migration pipeline later is idempotent (no conflict).
- **PENDING — code deploy.** The y-axis rescaling and the Bid_Ask restyle live in
  `api/_shared/cm-*.js`; they take effect only after the `cm/round66-export-feedback`
  branch is merged + deployed. Until then an export shows corrected *data* on
  old-style *charts*.

## 1. Files changed

| File | Change |
|---|---|
| `api/_shared/cm-native-chart-injector.js` | Per-vertical y-axis ranges (native Excel charts) |
| `api/_shared/cm-chart-image-renderer.js` | Same ranges mirrored for PNG/PDF parity |
| `supabase/migrations/20260693_cm_round66_dia_export_feedback_view_fixes.sql` | 10 dialysis view fixes → **Dialysis_DB** |
| `supabase/migrations/20260694_cm_round66_gov_export_feedback_view_fixes.sql` | 7 gov view fixes → **government** DB |
| `docs/capital-markets/ROUND66_EXPORT_FEEDBACK_WORKLOG.md` | This worklog |

> **Deploy target matters:** the two migrations create `cm_dialysis_*` / `cm_gov_*`
> views that live in the **domain** databases, *not* LCC Opps. Apply
> `..._dia_...` to Dialysis_DB (`zqzrriwuavgrquhisnoa`) and `..._gov_...` to the
> government project (`scknotsqkcheojiaewwh`).

---

## 2. Y-axis rescaling (both verticals)

Mechanism unchanged from R37/R61: per-template `yAxisRange` / `yLeftRange` /
`yRightRange` in the injector, mirrored on Chart.js `scales.y/y1` in the renderer.
Because several templates render for **both** verticals but were flagged for only
one (or need different bands), every shared template now branches on `vertical`
so the un-flagged vertical is untouched. Ranges were chosen from the **measured**
p5/p95 of each series (see §3 validation notes), not guesses.

| Chart (tab) | Vertical | New y-axis | Was |
|---|---|---|---|
| Cap_Avg (`cap_rate_ttm_by_quarter`) | dia | 5.75–8.5% | 5–10% |
| Returns_Idx (`cash_leveraged_returns`) | dia | 4.5–11% | auto |
| Returns_Idx | gov | 7.5–10% | auto |
| DOM_Ask (`dom_and_pct_of_ask`) | dia | left DOM 75–300; right %ask 70–100% | right 85–105% |
| Sentiment (`seller_sentiment`) | dia | 5.0–9.0% | ~4.75–9.25% |
| Sentiment | gov | 6.0–9.0% | ~5.5–9.5% |
| Val_Index (`valuation_index`) | dia | 75–250 | ~60–230 |
| Val_Index | gov | 210–350 ($/SF) | ~180–320 |
| Active_Cap_Quart (`asking_cap_quartiles_active`) | dia | 5.0–7.5% | 5–8% |
| Sold_Cap_by_Term (`sold_cap_by_term_dot_plot`) | dia | 5.0–9.75% | 4–11% |
| Sold_Cap_by_Term | gov | 6.0–11% | 4–11% |
| Ask_Cap_by_Term (`asking_cap_by_term_dot_plot`) | dia | 5.0–8.0% | 4–11% |
| Cap_by_Term (`cap_rate_by_lease_term`) | gov | 5.5–8.5% | 4–11% |

**Scope guard:** `Data_Cap_Quartile` (`cap_rate_top_bottom_quartile`) was **not**
in this notes batch, so it is intentionally left at its prior R63 band (5–9%). An
initial draft had widened it; that was reverted to avoid changing an un-flagged
chart.

---

## 3. Data / formula fixes

### Dialysis (migration → Dialysis_DB)

1. **`cm_dialysis_bid_ask_spread_m` — additive identity restored.** The spread
   was stored as `abs(last_ask − sold)` and then *subtracted* from last-ask, so
   "last-ask + spread ≈ sold cap" never held (off by ~39 bps). Now the spread is
   **signed** (`sold − last_ask`) and the derived sold cap = `last_ask + spread`.
   Validated: 0.06381 + 0.00175 = 0.06557; identity holds.

2. **`cm_dialysis_nm_vs_market_m` — market excludes NM + off-market; NM n-gated.**
   The "market" line now excludes Northmarq **and** unbrokered/off-market deals
   (brokered = has listing/procuring broker or `is_northmarq`), so it represents
   the *brokered* benchmark NM competes against. NM leg gated at n≥3 before
   smoothing; both legs smoothed on the same window. (NM is identified by
   `is_northmarq`; there is no broker-text to widen.)

3. **`cm_dialysis_notable_transactions` — de-duplicated.** Collapsed to one row
   per property (most-recent, then highest price); removed 29 duplicate rows
   (262→233); rank recomputed by price.

4. **`cm_dialysis_industry_participants` — junk buckets cleaned.** Blank
   `chain_organization` ("Unreported") no longer competes for the Top-10; the tail
   + blanks roll into a single **"Other / Independent"** row. Percentages sum to
   1.0000; no clinics lost.

5. **`cm_dialysis_available_market_size_q` — 10+yr cap inversion fixed.** Root
   cause: the firm-term lookup counted **superseded/inactive** leases, mis-binning
   short leases into the 10+ cohort and inflating its cap above the whole market.
   Fixed upstream in `cm_dialysis_active_listings_q` (firm-term lateral now
   requires `is_active` and excludes `superseded/expired/terminated`); core-10+
   series gated at n≥5. After fix the core-10+ cap sits **below** the whole market
   (0.060 vs 0.067), as it should.

6. **`cm_dialysis_dom_price_change_active_m` — zombie-listing ramp fixed.** DOM was
   climbing ~30 days/month because listings with no `off_market_date` stayed
   "active" forever. The upstream active set now bounds still-active to listings
   seen/verified within ~120 days when `off_market_date` is null. The lock-step
   ramp (391→425→456→479…) becomes bounded/non-monotonic (361→392→375→406…).

7. **`cm_dialysis_inventory_backlog_m`** and 8. **`cm_dialysis_market_turnover_m`
   — "no new listings since 2025" / collapsed pre-2022 counts fixed.** Root cause:
   ~34% of `available_listings` have a NULL `listing_date` (all closed), so they
   fell out of every on-market window. Both views now use
   `eff_start = COALESCE(listing_date, end_of_life − 196 days)` and
   `eff_end = COALESCE(sold_date, off_market_date)`. `added_ttm` recovers from
   3–21 to 158–178; turnover declines coherently (0.53→0.20) instead of ramping.

9. **`cm_dialysis_sold_cap_by_term_dot`** and 10. **`cm_dialysis_asking_cap_by_term_m`
   — cohort lines now move.** Combined the active-lease firm-term fix (#5) with a
   lower per-cohort gate (5→3) and wider smoothing. **Column names are unchanged**
   (no cohort renames — the chart mapper references them by name). Asking cohorts
   are now correctly ordered (12+ 5.96% < 8–12 6.27% < 6–8 6.86%). Note: the
   corrected 12+ cohort is *less* densely populated than before, because the old
   density was partly fake (superseded-lease contamination); remaining points are
   accurate.

### Government (migration → government DB)

1. **`cm_gov_bid_ask_spread_m` — sign flip.** Derived sold cap was
   `last_ask − spread`; corrected to `last_ask + spread` (spread is defined
   `sold − last_ask`). One-line fix; e.g. 0.0773 + 0.0083 = 0.0856.

2. **`cm_gov_cap_by_credit_q` — municipal/state cohorts recovered.** The credit
   classifier only had a federal agency-text branch, so state/municipal tenants
   (identifiable from `agency` text) fell to NULL and were dropped. Added
   municipal + state agency-text branches *before* the federal branch ("County of
   X" → municipal; "State of X" / "Department of Human Resources" → state;
   "Department of Defense/Justice" stays federal). State cap now populates
   (0.062–0.079, above federal as expected). **Municipal remains genuinely sparse**
   (most reclassify to state via `government_type='Local/State'`); gate lowered to
   n≥2 so it surfaces where data exists.

3. **`cm_gov_cap_by_term_m` — two real bugs fixed.** `cap_5to10` was a verbatim
   duplicate of `cap_6to10`; it is now a genuine [5,10) bucket. The [5,6) gap
   between `cap_less5` (<5) and `cap_6to10` (≥6) is closed. Term resolver gained a
   fallback to the sale row's own `firm_term_years` / `lease_expiration`, lifting
   fill to 158–166 of 171 months. Lines now vary over time.

4. **`cm_gov_cpi_vs_renewal_cagr_m` — NO CHANGE (true data gap).** GSA renewal
   events only exist from **2013-02**; the metric is a trailing **5-year CAGR**, so
   the earliest possible value is ~2018-02 (confirmed against
   `cm_gov_renewal_rent_growth_m.cagr_5yr`). To start the line ~2016 you would have
   to redefine the metric to a 3-year CAGR — a definition change, not a bug fix.
   Left out of the migration intentionally.

5. **`cm_gov_nm_vs_market_m` — NM de-whipsawed; market excludes NM + off-market.**
   NM monthly sample is thin (1–22, often 1–2) with no n-gate, so the line
   whipsawed. Now gated at n≥3 before smoothing; market leg recomputed to brokered,
   non-NM only (`transaction_type='brokered'`). Attribution itself is clean (123
   `is_northmarq` rows; no broker-text mislabeling).

6. **`cm_gov_seller_sentiment_m` — ">100%" impossible value fixed.** The
   "% price-adjusted during marketing" used a **biased denominator** (only rows
   where both last & sold price exist), pinning it at 79–100%. Now mirrors the `_q`
   sibling: stored `had_price_change` over **all** sales in the window. Result lands
   at a sensible **0–5.5%**.

7. **`cm_gov_valuation_index_m` — append-only rebased index.** `valuation_index`
   (= NOI/cap = raw $/SF, ~210–350) is mathematically correct; it "didn't move like
   Excel" because the reference is rebased to 100. Appended a new
   `valuation_index_rebased` column (base-100) at the end; the existing column is
   untouched.

8. **`cm_gov_inventory_backlog_m` — NO CHANGE (skipped).** The [start, open-end]
   window logic is already correct. The optional 730-day staleness cap was tested
   and is **inert** in this DB (max delta vs uncapped = 0), so it was omitted as
   pure complexity. The thin/never-closed `available_listings` is a data-hygiene
   matter, not a view bug.

9. **`cm_gov_market_turnover_m` — counts listings, not the GSA lease stock.**
   `active_count` was counting the entire `gsa_leases` stock, which grows
   monotonically to ~4,677 (over the ~4,500 ceiling you flagged) and buried the
   monthly sales rate. Now counts active **listings** from `available_listings` via
   the [start,end] window (≤~64), and appends `monthly_sales_count` so the per-month
   rate is visible. (Caveat: `available_listings` coverage is thin — see §5.)

10. **`cm_gov_sold_cap_by_term_dot` — robustness.** Widened smoothing ±2→±3 and
    clamped each cohort to [0.04, 0.12] before smoothing so single-deal quarters
    stop whipsawing the dots. Column names unchanged.

---

## 4. Bid_Ask style/color match (R66b — done)

The data issue on Bid_Ask (the additive-identity formula) is fixed in §3. The
visual note — *"style and colors still don't match our Excel/PDF versions"* — is
now matched against the supplied **`Dialysis Comp Work MASTER.xlsx`** (its
`xl/charts/chart7.xml` is the Bid-Ask exhibit). What the master actually uses:

- A 2-series **line chart with NO connecting line** — each point is a **`dash`
  marker, size 7**.
- **"Last Ask (ttm)" = Sky `62B5E5`**; **"Bid-Ask Spread" = Navy `003DA5`**
  (the navy series sits at `last_ask + spread`, i.e. the achieved cap; the visual
  gap between the two rows of dashes *is* the spread).
- Single left value axis **5.25%–8.00%**, format `0.00%`; date cat-axis `mmm-yy`;
  axis text `9EA9B7` 8 pt; gridlines on; legend bottom.

Changes applied (both `cm-native-chart-injector.js` and
`cm-chart-image-renderer.js`):

- Markers switched from square(5)/circle(4) → **`dash` size 7** (Chart.js
  `pointStyle:'dash'` in the renderer).
- **Colors un-swapped** to match the master: Last Ask → Sky, Achieved/Spread →
  Navy (we previously had them reversed — the actual cause of the "colors don't
  match" note). Colors come from the `navy`/`sky` brand tokens (`003DA5`/`62B5E5`).
- Y-axis pinned to the master's **5.25–8.0%** for dialysis; gov keeps the wider
  5.5–10% band (its last-ask caps run to ~8.5% plus the dispersion band).

**One judgment call:** the master plots *only* the two dash series. Our chart also
draws a faint min→max **dispersion band** (recolored to neutral gray `D9D9D9` to
match across xlsx/PDF) — kept because your note called the current layout "much
better." If you'd rather match the master exactly (no band), it's a one-line
change: drop the `barSeries` block in the `bid_ask_spread` case so it renders as a
pure 2-series dash chart. Say the word and I'll strip it.

---

## 5. Data-hygiene dependencies (not fixable in the view layer)

Two upstream data problems cap how clean some views can get; flagging for an
ingestion-side fix:

1. **Dialysis `available_listings.listing_date` is NULL on ~34% of rows** (all
   closed listings). The R66 views synthesize an effective start
   (`end_of_life − 196d`) as a reporting-layer mitigation, but the durable fix is
   to populate `listing_date` (and/or `created_at`) at ingest.
2. **Listings rarely get an `off_market_date`** (gov `available_listings` is ~81%
   never-closed; the universe is only ~427 rows). This makes gov turnover/backlog
   volatile until closures are back-filled. The dia DOM fix bounds the worst cases
   via a freshness signal, but back-filling `off_market_date` is the real fix.

A standardization pass on the cap-rate COALESCE order
(`COALESCE(calculated_cap_rate, stated_cap_rate, cap_rate)` everywhere) is also
recommended — it's currently inconsistent across views.

---

## 6. Cost-of-capital spread question (answer)

> *"Now that we track loans and interest rates historically, is there a more
> scientific way to attribute the 180–220 bps spread over the 10-year Treasury,
> extrapolated from the loan data we collect?"*

**Yes in principle, and the schema already supports it — but the data isn't there
yet.** Findings from the live loan tables:

- **Dialysis `loans`:** 512 rows, but only **4** carry *both* `interest_rate_percent`
  *and* `origination_date`.
- **Government `loans`:** 1,054 rows, **88** with rate + origination date (1996–2026,
  avg ~5.06%). A `spread_over_index` column exists but is populated on **0** rows.

So today there is not enough dated rate coverage to replace the fixed 180–220 bps
with an empirically-derived market spread (4 and 88 observations, unevenly spread
across 30 years). The fixed band remains the right modeling assumption for now.

**Recommended methodology once coverage grows (target the CMBS pipeline, Round
76ek, to populate `interest_rate` + `origination_date` + `spread_over_index` at
ingest):**

1. At each loan's `origination_date`, join the contemporaneous **10-year constant-
   maturity Treasury** (the macro series already feeds `cm_*_macro_rates_m` /
   `treasury_10y_yield`).
2. Compute `observed_spread = loan_coupon − 10y_CMT` per loan (filter to
   fixed-rate, stabilized, comparable-LTV deals to avoid mixing floating/construction
   paper).
3. Build a **trailing-N-month rolling median** observed spread (median + IQR trim to
   resist outliers); feed *that* into the loan-constant calc instead of the static
   180–220.
4. **Blend toward the prior** while thin: when the trailing window has < ~10–15
   qualifying loans, weight the 180–220 bps prior and taper it out as n grows
   (a simple credibility weight `n/(n+k)`).
5. Surface the derived spread + sample size on the `cost_of_capital` exhibit so the
   assumption is transparent and auditable.

Net: keep 180–220 bps as the modeled spread this round; the data-derived spread
becomes viable once the loan-rate backfill lands. The math and join path are ready.

---

## 7. Test + deploy

```powershell
# 1. JS syntax (run in repo root — the sandbox couldn't run this against the live files)
node --check api/_shared/cm-native-chart-injector.js
node --check api/_shared/cm-chart-image-renderer.js

# 2. Apply the migrations to their DOMAIN databases (not LCC Opps):
#    20260693_..._dia_...  -> Dialysis_DB   (zqzrriwuavgrquhisnoa)
#    20260694_..._gov_...  -> government     (scknotsqkcheojiaewwh)
#    (apply via your normal domain-DB migration path / Supabase SQL editor)

# 3. Regenerate the exports and eyeball the flagged tabs/charts:
#    GET /api/capital-markets?action=export&vertical=dialysis&format=xlsx
#    GET /api/capital-markets?action=export&vertical=gov&format=xlsx
```

No new serverless functions were added; `ls api/*.js | wc -l` is unchanged.
