# CM Style Audit — Punch List

Generated 2026-05-21 from `audit/cm-style-audit/audit-master-vs-export.mjs`.

## TL;DR

The dia + gov masters live in `Team Briggs - Documents/.../*MASTER*.xlsx`. They pack
**all** their charts onto one or two big tabs (`Charts`, `Market Size`, `All Charts`,
`SSA Charts`), while the export splits each chart onto its own `Data_*` tab. So a
strict 1:1 row-vs-row diff isn't possible — instead we compared chart **kinds**
(line/bar/combo/etc.) and the visible styling each kind uses.

|   | dia master | dia export | gov master | gov export |
| --- | --- | --- | --- | --- |
| Sheets   | 13 | 48 | 10 | 49 |
| Charts   | 37 | 33 | 32 | 35 |

## Findings worth fixing

### A. HIGH — Chart titles missing on every export chart

Master charts have visible titles: `"LEASE TERM REMAINING"`, `"Core Dialysis"`,
`"Y-O-Y Change (%)"`, `"Cap by Credit"`, `"Average Asking Capitalization Rate (TTM)"`,
`"Percentage of Leases Renewed, Reduced or Expired"`, `"Market Share - Sold TTM"`,
etc. Export charts have **no titles** (all "_" in the inventory). Excel renders
titles above the plot area; without them you have to read the tab name to know
what you're looking at.

**Fix:** wire a per-template title into `buildInjectionSpec` (or pull from the
existing PDF-renderer title literal). Emit `<c:title>` block in each chart XML.

**Touches:** `api/_shared/cm-native-chart-injector.js` (all 6 series-bearing builders).

### B. MEDIUM — Number format style for negatives

Master uses the CRE standard `#,##0_);[Red]\(#,##0\)` and `&quot;$&quot;#,##0_);[Red]\(&quot;$&quot;#,##0\)`
which renders negative integers/currency in red parens (the textbook CRE format).
Export uses plain `#,##0` and `$#,##0` — negatives just render with a minus sign.

**Fix:** swap the `VAL_FMT_*` constants in `cm-native-chart-injector.js`:
  - `VAL_FMT_INTEGER` → `'#,##0_);[Red](#,##0)'`
  - `VAL_FMT_CURRENCY` → `'$#,##0_);[Red]($#,##0)'`
  - `VAL_FMT_CURRENCY_M` → `'$#,##0,,"M";[Red]$(#,##0,,"M")'`
  - etc.

Affects axis ticks + any data labels using these formats.

### C. LOW — Doughnut legend position

Master pies/doughnuts use bottom legend (b). Export uses right (r) on the 2
doughnut charts (`Data_Avail_Tenant_CountD`, `Data_Avail_Tenant_VolD`).
Switch to bottom for consistency with the rest of the deck.

**Fix:** `buildDoughnutChartXml` — change `<c:legendPos val="r"/>` → `b`.

### D. LOW — Tab color + freeze panes

Both master and export have no tab colors or freeze panes (`-` on both sides
in the inventory). No diff to fix; future polish opportunity if Scott wants
all `Data_*` tabs colored e.g. NM sky.

## Findings that look like diffs but are actually deliberate

### Color palette differences — DO NOT REVERT

Master mixes inconsistent palette: `9B88A5` purple-gray, `5FA3A8` teal,
`9EA9B7` slate, `B1DAF2` pale sky, `A8AD00` olive, `666666` mid gray,
`5B7F95` slate, `D4DEF0` very pale blue.

Export uses the canonical Northmarq brand: `003DA5` navy, `62B5E5` sky,
`265AB2` mid blue, `7E6BAD` purple, `4CB582` sage, `D97706` amber,
`6A748C` axis gray, `E0E8F4` pale, `9DC3E6` pale sky, `1F4E79` dark blue.

The master predates the November 2024 Northmarq brand standards refresh. The
export is correct; reverting to master's palette would violate
`docs/brand/NORTHMARQ_BRAND.md`.

### Quarter-format cat axis on every time-series chart — DELIBERATE (R37 P1)

Master uses `[$-409]mmm-yy;@` or `General` on cat axes. Export uses
`q"Q-"yyyy` ("1Q-2026") uniformly. This was R37 P1, responding to user
feedback item #4 ("we had previously displayed the labels in year and quarter
terms"). Don't revert.

### Y-axis pinning + percent/$ formats — DELIBERATE (R37 P2)

Master has `0.00%`, `0.0%`, `$#,##0` formats and rich range pinning (5-10%,
4.75-7.75%, 200-500, etc.). Export now matches this pattern from R37 P2.
Diff between formatting styles is the negatives idiom (see finding B above).

### Per-point data labels — DELIBERATE LIMIT (R37 P3)

Master has dense data labels (29, 52, 79 labels per chart on the chart-heavy
sheets — labels on every data point of the primary series). Export emits 3
labels per chart (peak/trough/most-recent) which is what R37 P3 delivered in
response to user feedback item #2 ("most of the data labels are gone, lowest,
highest and most recent"). The user explicitly asked for 3-label-style, not
every-point labels. Don't revert.

## Out of scope for the audit

The structural XML diff can't detect:

- Font family / size on chart titles, axis labels, tick labels (could add)
- Chart-area background fill color (could add)
- Plot-area gridline color (could add)
- Image positioning / cell layout around the chart (could add but tedious)
- Cover page / Index sheet branding (master has none; export has `Cover` +
  `Index` tabs which the master lacks entirely)

Run `node audit/cm-style-audit/audit-master-vs-export.mjs` to regenerate the
inventory whenever a fresh export is downloaded into Downloads.

## Files in this audit

- `audit-master-vs-export.mjs` — the audit script
- `dia-diff.md`, `gov-diff.md` — strict per-sheet diff (limited utility, see TL;DR)
- `dia-master-inventory.md`, `dia-export-inventory.md` — per-chart inventory tables
- `gov-master-inventory.md`, `gov-export-inventory.md` — same for gov
- `PUNCH-LIST.md` (this file) — synthesized findings for triage
