# Claude Code prompt — R2-A: de-smooth the remaining cap views + axis-fit (the recurring "still flat / still too smooth")

> June-29 round. Scott's recurring complaints (dia Active_Cap_Quart "hardly moving"; dia Ask_Cap_by_Term "not
> moving, should move like the sold chart"; gov Cap_by_Term "doesn't move logically / doesn't match PDF"; gov
> Sold_Cap_by_Term "still too smooth, doesn't match PDF") all trace to ONE root cause: **residual smoothing
> windows the T3/T3b de-smooth passes didn't reach** + a couple of over-wide axes. Grounded live. Mirror the
> T3/T3b fix exactly: drop the window, keep the density gate. dia `zqzrriwuavgrquhisnoa`, gov
> `scknotsqkcheojiaewwh`. View + chart-config; reversible; injector + image renderer in sync; ≤12 api/*.js.

## Receipts (grounded live 2026-06-29)
Views still carrying a smoothing `OVER(...)` window (the "still flat/smooth" cause):
- **dia `cm_dialysis_asking_cap_quartiles_active_m`** — HAS a window (T3b de-smoothed ask-cap-by-term but not
  this). The quartile data DOES move (upper 0.073-0.083 / lower 0.055-0.071, 86-103 distinct of 195) — the
  window flattens it.
- **gov `cm_gov_cap_by_term_m`** — HAS the ±3mo MA T9 added.
- **gov `cm_gov_sold_cap_by_term_dot`** — HAS a window (gov sold side never de-smoothed; T3 was dia-only).
- dia `cm_dialysis_ask_cap_by_term_m` — NO window (already de-smoothed); its data moves (142-173 distinct) but
  its CHART axis is **0.055-0.115** (6pt wide, stretched by the 6-8yr bucket's 0.110 high) → looks flat.

## Unit 1 — de-smooth the three windowed views (mirror T3/T3b)
Remove the centered/trailing moving-average `OVER(...)` window from the final SELECT of each, selecting the
gated values directly; **keep** the underlying TTM blend + the n≥ density gate + the bucket scheme:
- `cm_dialysis_asking_cap_quartiles_active_m` (+ any `_q`/dot variant the active-quartile chart reads).
- `cm_gov_cap_by_term_m` (+ `_q` / `cm_gov_sold_cap_by_term_dot`).
- `cm_gov_sold_cap_by_term_dot` (+ `_m`/`_q` siblings if present).
Expect choppier lines — that is the point (asking caps are gentler than sold, but they must show real
month-over-month movement; the n≥ gate is the honesty floor — do NOT re-add a smoother). After de-smoothing,
spot-check: rendered value == the raw gated value; distinct-value count rises.

## Unit 2 — axis-fit the cap-by-term / quartile charts (data-driven, T2 pattern)
After Unit 1, re-fit each affected chart's cap axis to its plotted series via the existing
`fitDataAxisRange('cap')` (compute min/max over the plotted data ± a small pad, clean bounds) — do NOT leave a
hardcoded wide range:
- dia **Asking Cap Rate Ranges by Lease Term** — current 0.055-0.115 is too wide; fit to the plotted buckets
  (~0.055-0.095, with the 6-8yr outlier handled — either let the fit include it or clip per the density gate).
- dia **Asking Cap Quartiles — Active** — fit after de-smooth (was 0.05-0.085).
- gov **Cap by Remaining Lease Term** (was 0.06-0.08) + gov **Sold Cap by Term** — fit after de-smooth.
Keep injector + image renderer ranges in sync.

## Unit 3 — dia Sold Cap by Term: <5yr cohort filter (June-29 dia note)
Scott: the dia Sold_Cap_by_Term "<5 year" cohort "looks like it might need work — is it including sales we do
not have lease term for? We might need a 6-month-to-5-year filter." **Investigate:** does the `<5yr` (or
`≤5yr`) bucket include sales with NULL / 0 firm-term (no lease term known) that get dumped into the lowest
bucket? If so, **exclude no-lease-term sales** from the term buckets (require a known firm term in
[0.5yr, 5yr] for the <5 bucket) so it reflects real short-term deals, not unknowns. Report the count moved out.
Same check on the gov sold-cap-by-term <-bucket. No fabrication — unknown-term sales drop out of the term
breakdown (still counted in the overall, not in a term bucket).

## Gate
- The 3 windowed views no longer apply a moving average; output == raw gated values; distinct-value counts up;
  lines show real movement (dia quartiles + ask-by-term move; gov cap-by-term + sold-by-term move and read
  closer to the PDF/Excel). n≥ gates preserved.
- Cap axes re-fit data-drivenly (no over-wide ranges); injector + image renderer in sync.
- dia (+gov) Sold_Cap_by_Term <5 bucket excludes no-lease-term sales; count reported.
- Reversible (prior view bodies in migration headers); ≤12 api/*.js; both DBs.

## Boundaries
Removing redundant smoothers + fitting axes + a term-bucket filter only. Keep the TTM blend, the density
gates, the cap basis. No fabricated data. This is the same proven de-smooth pattern as T3/T3b, applied to the
views those passes missed.
