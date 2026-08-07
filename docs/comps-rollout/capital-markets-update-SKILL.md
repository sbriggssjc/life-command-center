---
name: capital-markets-update
description: >
  Write the quarterly Capital Markets Report copy for a net-lease swimlane (Dialysis Market Filter now,
  Government Market Filter next) straight from the frozen figure packet — no Excel export, no MasterPasteReady
  disambiguation. Use whenever Scott asks to update, refresh, or draft the Capital Markets Report copy for a
  quarter — e.g. "Update the Dialysis Market Filter for Q2 2026," "refresh the CM report copy," "draft the
  capital markets marketing email for Q# YYYY," or after a "packet frozen" Teams card. Wraps the
  get_capmarkets_packet MCP tool (freeze-or-fetch) with a fallback that queries the cm_* views directly at a
  pinned period_end, and enforces the 4Q2025-final style, the never-copy-forward rule, and deterministic
  [CONFIRM] flag rendering. Distinct from comps-engine (deal-level sales comps) — this skill writes the
  quarterly market-report narrative + marketing email.
---

# Capital Markets Report — Quarterly Copy Update

One frozen figure packet per (vertical, quarter) drives every page's copy and the marketing email, so the
letter, the tiles, and the charts can never diverge. The database layer (`cm_view_registry`,
`cm_period_anchor`, ~70 `cm_dialysis_*` views) already exists; this skill turns it into report copy.

## Trigger phrases
"Update the Dialysis Market Filter for Q# YYYY", "Update the Government Market Filter for Q# YYYY", "refresh
the CM report", "draft the capital markets copy / marketing email for Q# YYYY", or a Teams card announcing
"Q#-YYYY capital markets packet frozen — attach the marketing draft and run the capital-markets-update skill."
When Scott attaches marketing's draft PDF, reconcile against it — never copy its numbers forward.

## Step 1 — get the packet (freeze-or-fetch)

**Preferred (once the tool ships):** call MCP `get_capmarkets_packet({ vertical, quarter })` where
`vertical` ∈ `dialysis` | `government` and `quarter` is `Q2-2026` form. It freezes the quarter into
`cm_report_snapshots` on first call and returns the frozen row forever after — so re-runs of the same quarter
are byte-identical. The packet is page-keyed (`pages.p19_volume_caps`, `pages.p27_cost_of_capital`,
`pages.p54_value_prop`, …), carries `comparatives` (prior_q, year_ago), `value_prop` basis selection, and a
deterministic `flags[]` array. **Never recompute a frozen quarter by hand** — trust the packet.

**Fallback (usable TODAY, before the tool ships):** query the `cm_*` views directly via the Supabase
connector, pinned to the quarter-end. This is exactly what the plan-authoring session did.
- Resolve `period_end` = the last day of the quarter (`Q1`→`03-31`, `Q2`→`06-30`, `Q3`→`09-30`, `Q4`→`12-31`).
  Do NOT let a KPI view return a live/off-quarter window — always filter `WHERE period_end = '<YYYY-MM-DD>'`.
- Dialysis views are `cm_dialysis_*` (registered in `cm_view_registry` with `vertical='dialysis'`); government
  will be `cm_gov_*` (`vertical='government'`). Pull the anchor quarter plus the prior quarter and the
  year-ago quarter for the comparatives, and the long-run series (for avg / max+date callouts).
- The anchor helpers `cm_period_anchor` / `cm_last_completed_quarter_end()` give the completed-quarter grid —
  read them; don't invent a period.
- Snapshot-only views (`cm_dialysis_available_by_tenant`, `_by_term_bucket`) return current-day only and will
  NOT reproduce a past quarter-end table (gap G2) — say so rather than back-filling from the live number, until
  the period-keyed `_q` variants land.
- Every figure you print must trace to a queried row. If a view returns Q2/Q3 for a Q1 ask, you pinned the
  wrong period — stop and fix the filter; do not print the drifted number.

## Step 2 — write the copy (4Q2025-final style)

Match the 4Q2025-final edition exactly — this is a fidelity task, not a rewrite:
- **Bold intro labels** opening each paragraph, **bold inline figures**, *italic footers* for
  source/methodology, two-column read.
- Numbers ≥ 1000 use commas; cap rates shown as percentages to two decimals (the views store decimals —
  0.0694 → **6.94%**); `$` and `+` superscript on hero numbers per the Northmarq brand.
- Page-by-page, in report order. Every page's figures come from its packet key (or its pinned view in fallback
  mode), never from the prior edition or the marketing draft.

**Never copy forward.** A figure that isn't in this quarter's packet/pinned view does not go in the copy. If a
prior edition printed a number that this quarter's recompute changes by >5%, that's a restatement — surface it
(see flags), don't silently keep the old one.

## Step 3 — render the [CONFIRM] flags (deterministic, from the packet)

Flags are generated in code (packet `flags[]`) or, in fallback mode, by applying the same rules yourself:
- **thin_sample** — any cohort `n < 10` (e.g. 10+ yr seller sentiment, NM value-prop sample). Print the n.
- **null_series** — a view returned null/empty for a page that expects a value.
- **rate_basis** — 10Y UST close missing, quarter-average used instead (`treasury_10y_close` null → `_avg`).
  Say "quarterly avg" explicitly.
- **restatement** — a frozen prior-edition figure differs >5% from the live recompute; state the old→new and
  the reason (e.g. expanded capture restated YE25 TTM volume $497M → $765M).
- **value_prop basis** — report `basis_period` + `basis_reason` (latest TTM with NM n ≥ 15) + the sample
  counts, so the tiles/chart/letter all cite the same basis.

The marketing email's [CONFIRM] section is exactly this flag list — deterministic, not judgment-by-vibes. If
`flags[]` is empty, say "No confirmations required — all figures reconciled to the frozen packet."

## Step 4 — output contract

Emit **one markdown document**: the page-by-page copy followed by the marketing email. No placeholders, no
"TBD", no bracketed instructions to the reader other than the deterministic [CONFIRM] flags. Every bolded
figure must be traceable to a packet key or a pinned view row. When the frozen packet exists, name the
`snapshot_id` / `frozen_at` in the italic footer so the edition is auditable.

## Government Market Filter path
Same skill, no new orchestration. Once the `cm_gov_*` views are registered in `cm_view_registry` with
`vertical='government'`, the prompt becomes "Update the Government Market Filter for Q# YYYY" and everything
above applies — swap the tenant taxonomy to federal/state/municipal, add the agency-credit / OPM-workforce /
FRPP-occupancy pages, and pull tenant-credit narrative live from the gov Supabase (`scknotsqkcheojiaewwh`).
Every additional swimlane is just a registered set of views.

## QC pass (recommended)
After writing, run a numbers-match check: extract every bolded figure from the emitted copy and diff it against
the frozen packet (or the pinned view rows). This is deterministic verification — no creativity — and can run
on-box (plain Python or a local model). Claude writes; the checker verifies.

## Known quirks (exporter / data layer)
Read before touching `api/capital-markets.js`, `api/_shared/cm-excel-export.js`, or a `cm_view_registry`
row. Each bit someone once and is easy to reintroduce.

- **A new series must be REGISTERED in `cm_view_registry` to get an x-axis crop — synthetic series
  included.** The exporter crops each sheet's left edge to a per-series `display_from` (first period the
  series clears its density floor) resolved from `cm_view_registry` by `chart_template_id`. A series with
  **no registry row gets no crop and ships its whole history** (the 2001-start-instead-of-2007-03-31 bug).
  When you add or re-home a sales-derived sheet:
  1. Insert a `cm_view_registry` row (`ON CONFLICT (view_name) DO UPDATE`), then `SELECT
     cm_refresh_display_from();`. Sales series share the TTM sale cohort, so set `n_column='ttm_count'` +
     `n_source_view='cm_dialysis_count_ttm_q'` (threshold 25 / 4 consecutive q → `2007-03-31`); they do NOT
     need their own count column.
  2. **Synthetic series (`view_name_template` starts `__synthetic__:`) need the crop applied in code too.**
     The realCharts fetch loop crops real views, but synthetic composers build rows *after* it — they read
     `masterMonthlyRows` (uncropped back to 2001) or other charts, so they need an explicit
     `cropRowsToDisplayFrom(rows, tmpl, resolveDisplayFrom(displayFromRows, id, view_name_template))` in the
     `synthCharts` construction. Register them with the synthetic marker as the PK `view_name` (e.g.
     `__synthetic__:quarterly_volume_bars`); `cm_compute_display_from` reads `n_source_view`, not
     `view_name`, so the marker is fine, and `resolveDisplayFrom` matches on `chart_template_id`.
  3. A YoY-delta synthetic (e.g. `pace_of_cap_rate_expansion`) inherits its already-cropped base series and
     naturally starts ~one lag later (2008), so its 2007-03-31 crop is a harmless no-op — register it for
     completeness, don't expect it to start 2007-03-31.

- **Data_Bid_Ask "Achieved Cap (TTM)" is a native-chart HELPER column, not a view column — don't also add
  a static one.** The `bid_ask_spread` injector spec (`cm-native-chart-injector.js`) declares a
  `helperCols` entry `achieved_cap = avg_last_ask_cap + avg_bid_ask_spread` and binds the chart's navy
  "Achieved" marker line to it dynamically via `String.fromCharCode(65 + cols.length)` (the column right
  after the static `CHART_COLUMNS.bid_ask_spread` set; the R53 wrapper shifts it +1 for `period_label`).
  The view's own `achieved_last_ask_cap` computes the *identical* value, so listing it in
  `CHART_COLUMNS.bid_ask_spread` renders a **duplicate** "Achieved Cap (TTM)" column. Keep the helper (the
  chart depends on it); do not re-add the static column. The distinct `min/max_last_ask_cap`
  (Last Ask — Low/High) range columns are legitimate and stay.

## Reference
- Build plan + packet shape: `docs/comps-rollout/capital-markets-update-PLAN.md` (Section 4, 7).
- Companion deal-level skill: `comps-engine` (sales comps, not market-report copy).
- Data topology: Dialysis DB `zqzrriwuavgrquhisnoa`; Government DB `scknotsqkcheojiaewwh`.
