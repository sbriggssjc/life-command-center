# Claude Code prompt — T1: extend long-history charts to their real data start (fix the truncation)

> Catalog topic **T1** (history depth) — drives ~12 of Scott's June-23 notes (dia 2/4/5/7/8/9/13,
> gov 17/20/26/30/32). Grounded receipts-first against the June-23 exports + live DBs: **this is
> dropped data, not absent.** The cap-rate-family charts truncate their plotted series start; the
> underlying data exists years earlier. Fix the chart range; do not fabricate where data is genuinely
> thin. dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`.

## Receipts (June-23 export, verified)
Data populated continuously from **2001** (12/12 months/yr) for Cap-TTM-Avg, Volume, Txn-Count;
from **2005** for Cap-by-Term. But the chart **series ranges** truncate:

| Chart | data table starts | chart series plots from | ≈ truncated to | Scott's note |
|---|---|---|---|---|
| Cap Rate — TTM Avg | 2001 (row 5) | **row 101** | ~2009 | "missing 2013 & earlier" |
| NM vs Market — Cap | 2001 | **row 233** | ~2020 | "further back than 2020" |
| Annualized Return Index | 2001 | **row 101** | ~2009 | gov 20 "back to 1997" |
| Cap by Remaining Term | 2005 | **row 125** | ~2015 | "before 2015" |
| **Sales Volume — TTM** | 2001 | **row 5** | full ✓ | (correct — the template) |
| **Transaction Count — TTM** | 2001 | **row 5** | full ✓ | (correct) |

So Volume/Txn already plot the full history; the cap-rate family does not. The truncation is a
**series-range / `dataStart` bug specific to the cap-style charts**, not a data gap.

## The ask
1. **Find the `dataStart` logic** in the export chart builder (`cm-excel-export.js` / the native-chart
   injector) that yields row 101 / 233 / 125 for the cap-family charts while volume/txn use row 5.
   It's likely a per-chart "skip N rows" / minimum-observations offset that's too aggressive (or a
   fixed window) for cap charts.
2. **Extend each truncated chart's plotted range to its first robust data row** — same behavior as the
   volume/txn charts. Define "robust start" by a single consistent rule (e.g., first month whose value
   is non-null AND backed by ≥ a small sales floor), not a hardcoded offset. Targets:
   - **Cap-TTM-Avg, Returns Index → ~2001** (data is 12/12 from 2001).
   - **Cap-by-Term → ~2005** (first populated), per bucket (a bucket starts when it has observations).
   - **NM vs Market** — see #3 (it's the nuanced one).
   Apply to BOTH dia and gov (same charts truncate on both).
3. **NM vs Market nuance:** the NM line is genuinely sparse in the early years (few NM sales), but the
   **market comparison line should extend back to the full history** (2001) like the main Cap-Avg
   chart. Don't truncate the whole chart to 2020 just because the NM series is thin early — plot the
   market line full-range and let the NM line begin where NM sales become non-trivial (gap-honest), so
   the chart shows long-run market context with the NM overlay where it exists.
4. **Gap-honest, don't fabricate:** where a specific early period is genuinely null/thin (e.g., dia
   Cap-by-Term <=5yr bucket has no data before 2014; 2003 is a thin month-set), let the line gap rather
   than interpolate or back-fill invented values. Extending the *range* is the fix; inventing points is not.
5. **Leave the genuine capture-floor charts alone:** availability/active-listing charts (Market
   Turnover from 2014, Available Market Size from ~2015, anything sourced from `available_listings`
   which only begins 2022-07) have a REAL collection floor — do not extend those earlier (that's a
   separate topic, T4). This prompt is only the cap/volume/returns/term **sales-history** family.

## Gate (verify against the regenerated export)
- Cap-TTM-Avg, Returns Index plot from ~2001; Cap-by-Term from ~2005; on both dia and gov.
- NM vs Market shows the market line back to ~2001 with the NM overlay where it exists.
- Volume/Txn unchanged (already full-range). No invented/interpolated early points — thin periods gap.
- Confirm the plotted series `$X$<start>` row now equals the first robust data row (not 101/233/125).

## Boundaries
Chart-range / export-config only — no change to the `cm_*` data views or the underlying values (the
data is already correct and present). Don't touch the availability-floor charts. Reversible.
