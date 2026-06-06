# Claude Code prompt — Round 70: June-6 export review (39 notes, both verticals)

> Scott's third review pass (June-6 exports — note these PREDATE the #1077
> merge/redeploy, so G36/turnover-series wiring is already fixed and excluded).
> This round has three layers: (A) DEFINITION CORRECTIONS from Scott (spec, not
> bugs — implement as stated); (B) data-depth items, several recurring — these
> now need the receipts-first treatment with per-period n tables, not another
> gate pass; (C) a large axis/color formatting batch.

```
LAYER A — DEFINITION CORRECTIONS (Scott's spec; implement, both verticals where noted)

A1. GOV CORE = 6+ YEARS FIRM TERM (G30/G34, dia D8 spot-check).
    Scott: "for government, our core definition is 6+ years of firm term as the
    cohort, not 10+." Update every gov "core" consumer (core cap-rate dots,
    avail-market core avg, core asking quartiles) from >=10 to >=6 firm years.
    DIA core stays 8+ — but SPOT-CHECK it (D8): Scott sees 9%+ caps in the dia
    core dot set that probably fail the 8+ qualifier; sample the >=9% core dots
    and verify their firm_term_years_at_sale >= 8 (suspect: term-missing rows
    defaulting into core, or the dot view using a different term source than
    firm_term_years_at_sale post-R69).

A2. PACE OF CAP EXPANSION = YoY DIFFERENCE IN BPS (D14 + G39, both verticals).
    Scott's formula: avg cap Jan-2024 6.50% vs Jan-2025 6.75% -> +25bps
    annualized pace. Current views compute month-over-month change annualized.
    Rewrite: pace_t = (ttm_avg_cap_t - ttm_avg_cap_{t-12mo}) in basis points,
    per cohort (all + the core cohort). Update axis/format (bps not %).

A3. GOV LEASE RENEWAL RATE = TTM ACTION COUNTS (G24) + STACKED BARS (G25).
    Scott: "There are not 11,000 leases that commenced in 2014... needs to be
    TTM action count per category, not a sum of the entire inventory."
    Receipts first: determine what the current series actually counts (the
    11,000 smells like cumulative inventory or per-event-row double counting in
    gsa_lease_events). Rebuild as TTM counts of ACTIONS per category (first-gen
    commencements / renewals / succeeding / expirations / terminations in the
    trailing 12mo — matching the deck p.28 table values: e.g. 2Q-2024 = 89/198/
    208/35/3). Then G25: render as STACKED bars (total height = total actions,
    category-shaded), not side-by-side/overlap — per the deck design.

A4. GOV VALUATION INDEX: LESS SMOOTHING + LONGER REACH (G20, also G21/G31).
    Scott: "Something changed... it looks smoother than what previous versions
    had. It no longer matches our Excel/PDF." The R69 24-month median windows
    over-dampened. Revisit: tighten the expense window (12-mo median) and/or
    drop the +/-2mo output smoothing so quarter-to-quarter movement shows;
    re-run the 8-anchor shape check (the master's own VI moves visibly).
    ALSO extend back toward 2000: gsa_snapshots starts 2013 — for pre-2013,
    evaluate a documented splice (master's own VI 1995-2013 as the historical
    segment, clearly tagged source='master_curated', joined at the 2013 rebase
    point). Scott explicitly wants the longer trend; a sourced splice is
    honest if labeled. Same x-axis-extension review for G31 (returns indexes,
    + its y-axis fix + missing YoY data) and G21.

LAYER B — DATA-DEPTH ITEMS (receipts-first; no more silent gates)

B1. GOV STATE/MUNI CREDIT LINES STILL MISSING (G16). Scott is right that the
    Excel built these from the same DB. The classifier fix recovered state to
    23 quarters/muni 9 — but the CHART still looks empty. Diagnose the chain:
    does cm_gov_cap_by_credit_q's n>=2 gate + the chart's rendering of sparse
    points (line with isolated dots = invisible) eat the recovered data?
    Options: marker-rendering for isolated points, pooling to annual for
    state/muni, or relaxing to n>=1 with markers. Show Scott's Excel-era
    coverage as the target: count classifiable state/muni sales per year in
    the DB and prove what's renderable.

B2. DIA 10+ LISTING COHORTS 2025+ STILL THIN (D3, D5, D7) + 10+ CAP ABOVE
    MARKET (D6). D6 is the sharp one: "the 10+ cohort average cap line should
    never be higher than the total market figure" — find the periods where
    cap_core_10plus > avg_cap_total and diagnose (tiny-n composition: 1-2
    high-cap deals vs a broader total — gate core line where n_core < 3, or
    the total excludes deals the core includes?). For the recurring 2025+
    thinness (D3/D5/D7): produce the definitive per-quarter n table for
    10+ listings 2024-2026 (post term-propagation) and either fix a remaining
    propagation gap (listings whose linked sale has a term but the listing
    view still misses it) or deliver the honest receipts that 2025-26 10+
    listings are genuinely scarce. This is the third pass — end it with
    receipts either way.

B3. DIA NEW-TO-MARKET 2025+ MISSING AFTER THE 2025 SURGE (D9) + ON-MARKET
    >350 PLAUSIBILITY (D10). D10 first — Scott doubts >350 active at peaks:
    AUDIT the active-universe eff-window (the 196-day fallback + 1095-day cap
    on synthetics may be stacking synthetic windows into implausible peaks).
    Count organic vs synthetic in the >350 quarters; if synthetics inflate,
    tighten their eff-window to sale_date - dom_used (their actual imputed
    window, no 1095 tail). D9: the 2026 new-to-market counts post-surge —
    verify the 2026 organic capture is feeding (it was 79 in the review) and
    whether the chart's last points render.

B4. GOV SOLD + NEW-TO-MARKET SPARSE 2022+ (G35) — same audit as B3 gov-side.
B5. GOV NM LINE (G27) + DIA PRICE-ADJ 10+ 2024+ (D7 overlap) + GOV RENT-BY-
    YEAR-BUILT 2017+ (G29) + GOV CAP-BY-TERM QUALITY (G17) + DIA PRE-2010
    MECHANICAL (D13) + DIA/GOV "data gaps" (D11/D12, G37): for each, ONE
    receipts table (per-period n + source mix) and a verdict: fixable
    propagation gap (fix it) or genuine-thin (document on the chart note).
    G17 expectation-set: Scott believes Supabase should beat the Excel; if
    the gap is the curated-vs-market universe difference, SAY so with the
    master-vs-ours n comparison; if rent/term propagation genuinely lags
    (e.g. 7d unimported master rows), say that — it feeds the 7d decision.

LAYER C — FORMATTING BATCH (axis/color; injector + image renderer parity)

C1. Y-AXIS: G18 (axis issue — identify + fix), G19 (tighten to show avg
    movement), G31 (returns y-axis), G33 (tighten line movement), G38 (cap
    series offset so the two sets don't overlap), D4-adjacent items.
C2. X-AXIS REACH: G21/G23/G26/G31/G38 — extend to 2000 (or earliest
    consistent data) where the series supports it; G22 — START the CAGR
    x-axis at 2013 (no blank left region); D1/D2 — dia listing charts begin
    2018 because listing data starts ~2017; extend if the synthetic-backed
    universe supports a consistent line earlier, else document.
    G26: 10Y treasury series should reach the chart's start (macro_rates
    coverage — FRED has it; backfill the table if our copy starts late).
C3. COLOR/STYLE: D15 + G32 (cap dots invisible against bar fill — revise
    palette within Northmarq brand standards: bars to a lighter tint, dots
    to navy/tourmaline), G28 (avg renewal rent as a distinct-color dot).

ORDER: A (definitions — they reshape several series) -> B receipts -> C.
Bulk writes (if any propagation fixes emerge): dry-run -> verification gate.
View changes live with before/after receipts. Per-item before/after at
Dec-2025 in the PR. Note: G36 excluded — already fixed in #1077, lands on
the next redeploy.
```
