# CM Round 73 — Layer D: x-axis reach (density-gated) + receipts

**Date:** 2026-06-08 · **Author:** Claude Code (branch `claude/beautiful-hopper-j0he60`)
**Scope:** Extend each chart's x-axis floor (`MIN_YEAR_BY_TEMPLATE`, the native
xlsx catAx-start lever) to the earliest quarter the series **stays continuous** —
with a **hard per-chart density gate** (Scott): drop the floor only where there
are no multi-quarter gaps and no thin-n stretches that render as a flat/
mechanical line; where data genuinely thins before the target, **hold + document**
the honest start. JS-only (injector) — ships on the Railway redeploy. The PNG
renderer windows independently by count (no MIN_YEAR), so its reach is governed
by the 240-month / 104-quarter window + `cropForRender` downsampling.

`MIN_YEAR_BY_TEMPLATE` entries can be a static year OR a `(rows)=>year|null`
function (R69). The function form is what lets a **shared** template floor each
vertical at its own honest year — used here for the dia/gov-shared listing charts.

---

## D-#19 — net-lease-spread → 2002 (no FRED backfill needed)

The original ask implied a FRED DGS10 backfill to 2001. **Grounded live
2026-06-08, that was the wrong problem:** the treasury leg already exists.

- `economic_indicators` DGS10: 6,110 daily rows, **2002-01-02 → 2026-06-04**.
- `cm_gov_net_lease_spread_m`: chart spans 2001-01 → 2026-03 (cap data from
  2001-01), but `treasury_10y_yield` AND every spread series start **2002-01**
  (spread = cap − treasury, NULL through 2001 with no treasury).

So 2002 is the earliest **consistent** start (the view already emits the spread
from 2002), not 2001. **No write, no FRED, no gate** — just the catAx floor. The
spread is an average-based line (robust to moderate n), so 2002 is sound.
Added `net_lease_spread: 2002` + `net_lease_spread_q: 2002` (was unfloored).

---

## D-list density gate — per-chart verdicts (live, 2026-06-08)

| # | Chart | Old floor | New floor | Density evidence |
|---|-------|-----------|-----------|------------------|
| #12 | gov Bid-Ask | 2014 | **~2008** (gov) / ~2015 (dia) | paired ASK+SOLD months: gov 0 ≤2006, 5 in 2007, **12/12 from 2008**; dia 2/2/10 in 2012/13/14, **12/12 from 2015** |
| #15 | gov Cash & Leveraged | 2009 | **HOLD 2009** | cash/lev 12/12 from 2002, but it's a *smoothed index*; no sample-count column to gate, and the template is dia-shared — presence ≠ density (could show a flat line over thin years). Held — see note. |
| #16 | gov DOM & %Ask | 2018 | **HOLD 2018** | gov `cm_gov_dom_pct_ask_m` has **no n_sales column** → can't density-gate; held + documented |
| #26 | gov Volume+Cap | 2005 | **HOLD 2005** | quartile **bands** need richer sample than averages; gov TTM sales confirmable-rich (min 120) only from **2005** (`market_turnover` has no 2002-04 rows); 2002-04 quartiles emit but per-period n is unverifiable → hold |
| #2 | dia DOM & %Ask | 2018 | **2016** | dia n_sales (TTM) 10/14/**16**/30 in 2014/15/16/17; full 12-mo coverage from 2014; first 4-consec n≥15 = 2016 |
| #3 | dia Seller Sentiment | 2017 | **2016** | dia n_all 5/8/**15**/24 in 2014/15/16/17; cap lowered 2017→2016 (n=15 at 2016; 2014-15 n=5-8 held as the thin edge) |
| #7 | dia DOM & Price-Change | (none) | **unchanged** | already unfloored → reaches the 2013 data edge; no extension lever needed (2013 is thin n~6, but trimming is the opposite of "extend" — left for Scott's judgment) |

### Shipped (4 templates)
- **`net_lease_spread` / `_q` → 2002** (static; D-#19).
- **`bid_ask_spread` / `_monthly`** → `(rows)=>findFirstDenseYear(rows,'avg_last_ask_cap',0.0001) ?? 2014`. The view has no count column, but a real Last-Ask cap (~0.05-0.10) is only present once ask data begins, so "4 consecutive months of a non-null Last-Ask" is an exact presence gate for continuous bid-ask data. gov → 2008; **dia self-floors ~2015** (does NOT over-extend into thin pre-2015 listings); both fall back to 2014 if ask is absent.
- **`dom_and_pct_of_ask` / `_monthly`** → `(rows)=>findFirstDenseYear(rows,'n_sales',15) ?? 2018`. dia (carries n_sales) → 2016; **gov has no n_sales column → falls back to 2018 unchanged** (gov dom density not separately confirmable this round).
- **`seller_sentiment` / `_monthly`** → cap lowered `Math.max(findFirstDenseYear(rows,'n_all',5)??2014, 2016)`. dia → 2016; gov self-floors at its own dense year capped at 2016.

### Held with documented reasons (the disciplined gate outcome)
- **#26 volume_cap (2005):** quartile bands demand richer per-period n than
  average lines; gov sample is confirmable-rich (≥120 TTM) only from 2005, and
  the count source (`market_turnover`) has no 2002-04 rows, so 2002-04 quartile-
  grade density is unverifiable. 2005 is already the honest floor.
- **#15 cash_leveraged (2009):** `cm_gov_returns_indexes_m` exposes only the
  smoothed cash/leveraged index — no sample-count column — and the template is
  dia-shared. A presence gate would risk showing a flat smoothed line over a
  thin underlying sample (exactly the D13 anti-pattern), so it's held. The old
  `findFirstDenseYear(...,'transaction_count_ttm',15)??2009` was a misapplied
  generic fallback (that column doesn't exist in the returns view) — documented
  for a future round if a count column is added.
- **#16 gov DOM & %Ask (2018):** `cm_gov_dom_pct_ask_m` has no `n_sales` column,
  so the shared `dom_and_pct_of_ask` function falls back to 2018 for gov. Add a
  count column to the gov view to enable a gov-side extension.

---

## Render-path note
`MIN_YEAR_BY_TEMPLATE` governs the **native xlsx** chart's catAx start (the data
tab keeps all rows). The **PNG renderer** windows by count (monthly 240≈2006,
quarterly 104≈2000) and `cropForRender` downsamples-but-preserves-range beyond
the cap — so for the floors that reach pre-2006 (net_lease_spread 2002) the PNG
shows the full range via downsampling when served monthly, or natively when
served quarterly. Both paths extend; exact resolution differs.

## Verification
`test/cm-native-chart-injector.test.mjs` **183 pass / 0 fail / 1 skip** (added
R73 D-#2 / D-#12 / D-#19 floor tests; the existing R66aa dom test now also
proves the gov no-n_sales fallback to 2018; existing bid_ask "trims to 2014" test
still green via the fallback when ask is absent). `node --check` clean; 12
functions. JS-only → Railway redeploy.

## Follow-ups
- gov `cm_gov_dom_pct_ask_m` + `cm_gov_returns_indexes_m`: add a per-period
  sample-count column so #16 (gov DOM) and #15 (cash/leveraged) can be
  density-gated and extended (currently held for lack of a count column).
- #26 volume_cap: if Scott eyeballs the 2002-04 gov quartile bands and they're
  not erratically wide, lower to 2002; today held at 2005 (confirmable-rich).
