# Claude Code prompt — T3b-asking: de-smooth the dia asking cap-by-term (mirror the sold-side T3 fix)

> Scott (June-25, dia export): the **Asking Cap Rate Ranges by Lease Term** chart "moves too smoothly …
> the same data or formula issue that was adjusted for the sold cap rate ranges recently — the sold chart
> now moves like it's more accurate." Grounded: confirmed. The asking view still carries the moving-average
> the sold view had removed in T3. View-only fix on dia `zqzrriwuavgrquhisnoa`. Reversible. No data writes.

## Receipts (grounded 2026-06-24)
`cm_dialysis_asking_cap_by_term_m` final SELECT smooths every bucket through a **7-month centered MA**:
```
avg(gated.cap_12plus_g) OVER w  ...  (cap_8to12 / cap_6to8 / cap_5orless likewise)
WINDOW w AS (ORDER BY period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
```
…applied ON TOP of an already 2-year-TTM average + n≥5 per-bucket density gate. That double-smoothing is
what flattens the month-over-month movement. The **sold** equivalent `cm_dialysis_sold_cap_by_term_dot`
has **no window function** (T3 removed it) — which is why Scott now sees the sold line "move like it's more
accurate" while the asking line is still glassy. (Confirmed: `pg_views` — asking has a window fn, sold does
not.)

## The fix
- **Remove the 7-month `OVER w` MA** from `cm_dialysis_asking_cap_by_term_m`: select the **gated TTM bucket
  values directly** (`gated.cap_12plus_g` etc.), and drop the `WINDOW w` clause — mirroring the sold view's
  de-smoothed structure.
- **Keep everything else**: the 2-year TTM window, the **n≥5 per-bucket density floor** (it NULLs thin
  buckets → gap-honest, T1b), and the dia **4-bucket scheme** (12+/8-12/6-8/≤5). Those are correct; only
  the rolling MA goes.
- **Apply to the `_q`/dot variant if one exists** for asking (match whatever the
  `asking_cap_by_term_dot_plot` chart actually reads) so the rendered chart and any quarterly view both
  de-smooth consistently. Confirm the asking dot-plot chart renders the dia 4 buckets (not the gov 3-bucket
  scheme — the analogous mis-map T3b fixed on the sold LINE; verify the asking path doesn't have it).

## Expect / don't over-correct
The asking line will get **choppier** than before — that is the point, and it's correct: asking caps are
seller pricing and genuinely noisier than closed sales (the cohorts cross; see the chart caption). The
**n≥5 gate is the honesty floor** — do NOT re-introduce a moving average to "smooth" the choppiness back.
Pre-2020 stays thin/indicative per T1b (the existing 2017 display floor for this chart is unchanged — this
is movement, not history depth).

## Gate (verify live)
- `cm_dialysis_asking_cap_by_term_m` (and the dot/q variant) no longer apply a rolling MA; the bucket caps
  equal the gated TTM values. The asking cap-by-term line shows real month-over-month movement comparable
  in character to the de-smoothed SOLD line (spot-check a few months: raw gated value == rendered value).
- n≥5 gaps preserved where sparse; 4-bucket scheme intact; 2-yr TTM intact. Reversible (restore the
  `OVER w` MA). No data/row writes. ≤12 api/*.js (view-only).

## Boundaries / scope
dia ASKING cap-by-term only. NOT in scope (separate, queued): dia **asking cap quartiles flat** (active-cap
data review, T9), **gov Cap by Remaining Lease Term "all over the place"** (T9 — that's the opposite,
erratic-data problem, not over-smoothing), **gov core cap dot-plot outliers** (T9), and the gov
**termination COUNTS / active-leases-over-time** (T8). Keep `cap_rate_final`/`last_cap_rate` cap basis and
the term basis unchanged — this is purely removing the redundant smoother.
