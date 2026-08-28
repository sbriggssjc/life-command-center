### Deliverable Presentation (branded Excel / Word / PDF / OM / email)
Every generated deliverable is branded output, not a working file. Presentation is decided by the element's
ROLE, never by its content, and the same role looks the same in every table, every tab, every document, every
time. Full spec (numbered rules + traceability): `docs/os/BRANDED-DELIVERABLE-PRESENTATION-STANDARD.md`;
Excel enforcement lives in `bov-generator/bov_constants.py` (role registries + helpers) — use the helpers,
never per-tab literals.

**Geometry.** Row height and column width come from the named role registries (`ROW_H`, `COL_W`). Content
never drives height: if a label does not fit its role height on one line, shorten the label — do not grow the
row. A column that appears on more than one tab (PSF, $, %, date) is the same width on every tab.

**Text.** Labels are short enough to fit on one line at role height. Prose cells are merged across the table
width and never end in a one-word orphan line — shorten instead. Multi-value cells (e.g. three tenants) stack
one value per line inside the cell (newline + wrap), never a run-on with separators. Field labels Title Case,
section bars UPPER, one capitalization convention per tab. List cells (highlights, risks) use one spacing
convention across the whole table — no trailing blank lines.

**Tables.** Banding, borders and header fills span the FULL table width — no row shaded or bordered halfway.
Column-header alignment matches the data beneath it and the other headers in its row. Every roll-up table ends
with a Total / Weighted-Average row (weight named). Footnotes are merged across the full width of the table
they annotate, italic muted, attached to that table by a single spacer row — never a lone narrow wrapped cell.
Calculation helpers are not presentation: they live in a dedicated assumptions area or a hidden group, never
inline in a client-facing table.

**Numbers.** One format per kind of quantity, everywhere: currency, PSF, percent, term-in-years all carry the
same decimals and the same unit label on every tab. Show only periods that have data — never pad a grid.

**Sources.** Never render two rows for one period from two sources. One period, one number. Seller-provided
actuals outrank our estimate on a tie; name the source in the footnote; render `Conflict` when the two cannot
be reconciled and `Not on file` when absent. Never average, guess, or fill to make a table look complete.

**Families.** Tabs that describe the same thing over different periods (Expense History · Budget · Pro Forma
Economics) share one row-label vocabulary, one row order and one column geometry, differing only in periods
and values. A computed variance inside a named tolerance band renders as the band's phrase plus the figure
("At Market — 1.7% above consensus"), not a bare number implying false precision.
