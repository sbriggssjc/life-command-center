# Claude Code prompt — T2: fit the non-cap / secondary axes to the data (stop clip + whitespace)

> Scott's June-25 per-chart review. The cap-band auto-fit landed, but several secondary/percent axes are
> hardcoded to ranges that don't match the data — some **clip** the line, some leave it **crushed in a
> band of whitespace**. Fix is data-driven axis fitting (compute from the PLOTTED series ± a small pad,
> rounded to clean bounds), applied to BOTH the native Excel chart injector AND the PNG image renderer so
> they stay in sync. **Scope = ONLY the four charts below** (clean axis issues). Charts with open DATA
> issues are explicitly OUT (separate topics — see bottom). dia `zqzrriwuavgrquhisnoa`, gov
> `scknotsqkcheojiaewwh`. Config-only; reversible; no data/view changes.

## The four axis fixes (current → target; prefer a data-fit, these are the sanity bounds)
1. **dia `dom_and_pct_of_ask` — % of Ask right axis CLIPS.** Current `{min:0.84, max:0.96}`
   (`cm-native-chart-injector.js` ~3431 + `cm-chart-image-renderer.js` ~935). The dia % of ask runs
   **0.78–0.99**, so the line goes ABOVE 0.96 (2016→mid-2017) and BELOW 0.84 (2015) and clips. **Widen to
   cover the data** → ~`{0.78, 1.00}` (or data-fit: floor = min−~1pt, ceiling = max+~1pt). Must not clip.
2. **gov `dom_and_pct_of_ask` — % of Ask right axis TOO WIDE.** Current `PCT_OF_ASK_RANGE {0.85, 1.05}`.
   The gov line only moves **0.92–0.97**, so it's flattened into the middle with whitespace above/below.
   **Tighten** → ~`{0.90, 1.00}` (data-fit to the plotted window) so the movement fills the panel.
3. **gov `lease_termination_rate` — rate line ceiling TOO HIGH.** The rate line is visible and moves well
   but never exceeds ~10%, yet the axis ceiling is **25%** (`{0, 0.25}`, renderer ~1754). **Lower ceiling
   to ~`{0, 0.10}`** (data-fit max+pad) for more visible movement. (NOTE: this is ONLY the rate-line axis
   — the COUNTS bar-chart concern in your notes is a data issue, queued as T8 below.)
4. **dia `sold_cap_by_term_dot_plot` ("Closed Sales by Lease Term Remaining") — cap axis SQUEEZED.** No
   point goes above 7.50% or below 5.50%, but the axis is **5.00–10.00%** (`{0.05, 0.10}`). **Tighten** →
   ~`{0.055, 0.075}` (data-fit) so the term cohorts are readable. (Keep the existing T1b density floors /
   gap-honest rendering — this is axis range only.)

## How (durable, not just hardcoded)
- Prefer a **data-driven fit**: for each of these axes, compute min/max over the PLOTTED series (respecting
  the chart's `dataStart`), pad (~1pt for percent, ~10–15% of range for cap/rate), round to clean bounds,
  with a sensible floor so a near-flat series still gets a readable band. The codebase already has a
  `capFit` helper for cap charts — extend the same pattern to these percent/rate/secondary axes rather
  than swapping one hardcoded range for another.
- **Keep the injector and the image renderer in sync** — both carry these ranges; change both so the Excel
  native chart and the PNG match.
- Number formats unchanged (% 1-dp on the % axes; the cap axis stays %).

## Gate
- dia % of Ask line no longer clips (covers ~0.78–0.99); gov % of Ask fills its panel (~0.90–1.00, not
  85–105); gov termination-rate ceiling ~10% (movement readable); dia closed-sales cap-by-term tightened
  to ~5.5–7.5%. Both surfaces (Excel native + PNG) match. Reversible. No data/view change. ≤12 api/*.js.

## OUT of scope — DATA issues, queued separately (Scott: "resolve the data first before the y-axis")
Do NOT adjust these axes yet; they need data review first:
- **dia Asking Cap Rate Quartiles (active)** — quartile lines almost flat (core + overall); active-cap
  data looks static. → data review (T9).
- **dia Asking Cap Rate Ranges by Lease Term** — moves too smoothly; likely the SAME over-smoothing /
  bucket-mapping issue T3 fixed on the SOLD side, not yet applied to the ASKING side. → T3b-asking.
- **gov Cap Rate by Remaining Lease Term** — "moves all over the place"; data review. → T9.
- **gov core cap-rate dot plot** — 5–6 outlier sales to investigate/exclude; after that, a ~9% ceiling.
  → data review (outliers) then axis (T9).
- **gov Lease Termination — COUNTS bar (active leases by interval over time)** — should show MORE than
  ~1,750 active GSA leases in 2013; currently looks like only *currently*-active leases projected
  backward (point-in-time historical active-lease count, the ~8,000 vs ~1,750 issue). → T8.
