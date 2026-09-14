# Branded Deliverable Presentation Standard (BDPS) v1.0

> **Status:** canonical. The portable, surface-facing summary is
> [`canon/blocks/deliverable-presentation.md`](canon/blocks/deliverable-presentation.md) (rendered to every
> surface). **This file is the full spec.** Change a rule here AND in the block, bump `CANON_VERSION` in
> `canon/00-INDEX.md`, re-render per `SURFACE-SYNC-PROTOCOL.md`.
>
> **Scope:** every generated client-facing deliverable — BOV / master sheet (.xlsx), OM, Word memos, PDF
> exports, and branded HTML email. Excel is specified in the most detail because it is where the generator
> makes the most decisions; §18 binds the other formats to the same vocabulary.
>
> **Origin:** Scott's review rounds on the SSA — Savannah, GA master sheet (Rounds 19–20, 2026-08-28).
> Every rule below was raised as a specific defect on a specific cell. The traceability table in §19 maps
> each comment to the rule that generalizes it. **Nothing here is Savannah-specific.** The point of this
> document is that these get fixed once, in the generator, for every deliverable — not per workbook.

---

## §0 The governing principle

**Presentation is a function of an element's ROLE, never of its content.**

A section bar looks like a section bar. A data row looks like a data row. A footnote looks like a footnote.
The same role renders identically in every table, on every tab, in every deliverable, every time.

The corollary is the one that actually changes behaviour: **when content does not fit its role, the content
is wrong, not the layout.** Shorten the label. Summarize the sentence. Never grow a row, widen a column, or
shrink a font to accommodate a string that someone typed too long.

A reader should be able to move from tab to tab and land their eye in the same place every time. Every rule
below is in service of that.

---

## §1 Row heights — fixed by role

Row height is read from the `ROW_H` registry. There are no ad-hoc heights and no auto-fit.

| Role | Key | Height (pt) | Used for |
|---|---|---|---|
| Cover title | `cover_title` | 30 | The one 22pt title block on the Cover tab |
| Section bar | `section` | 18 | Navy full-width section headers |
| Column header | `col_header` | 16 | Header row of any table |
| Data row | `data` | 15 | Label + value rows — **the default** |
| Sub-label row | `sub_label` | 15 | Indented sub-items inside a section |
| Total row | `total` | 16 | Total / weighted-average rows |
| Prose / summary | `prose` | derived | Merged narrative cell — see §3 |
| Footnote | `footnote` | derived | See §4 |
| Spacer | `spacer` | 6 | Between a table and its footnote, and between sections |

**Rules**

1.1 Every row in a table body is `data` height. Alternating or drifting heights inside one section is a
defect — a section's label rows are all the same height as each other and as every other section's.

1.2 `prose` and `footnote` are the ONLY derived heights, and they derive from a computed line count at a
known merged width (§3, §4) — never from openpyxl auto-fit, which is not deterministic across renderers.

1.3 A row whose content does not fit at its role height fails validation. The fix is §2, not a taller row.

---

## §2 Labels must fit on one line

2.1 A label in a label column must render on ONE line at its role height in its column's role width.

2.2 The generator enforces a character budget per column role (`COL_W` → `max_label_chars`). A label over
budget is a hard validation failure naming the cell, the label, and the budget.

2.3 The fix is always a shorter label, chosen once and used everywhere. Prefer the shortest form that stays
unambiguous in context: *"Per RSF Leased"*, not *"Total Consideration Per Rentable Square Foot Leased"* —
the column header and section already carry the context.

2.4 Because labels are shared vocabulary across tabs (§17), a shortened label is changed in the label
registry, not on one tab.

---

## §3 Prose and summary cells

3.1 Any cell holding a sentence is **merged across the full width of its table** (first table column →
last table column) and wrapped, with `vertical='top'`.

3.2 **No orphan line.** The final rendered line must carry at least three words. A summary that hangs by
one word is a defect — the text is shortened until it fills its lines, or until it fits on one.

3.3 The generator computes the line count from the merged character width and sets height =
`lines × LINE_PT + PAD`. Deterministic, so the PDF export matches the screen.

3.4 Summary cells are written to a length budget supplied with the content, not trimmed after the fact by
whoever is looking at the workbook that day.

---

## §4 Footnotes

4.1 A footnote is **merged across the full width of the table it annotates** — same first and last column
as that table, so it visually belongs to it.

4.2 Style: italic, muted, 10pt (`FT_NOTE`), left/top aligned, wrapped, height per §3.3.

4.3 Placement: exactly one `spacer` row between the table's last row and the footnote. No blank row below
it before the next section bar. A footnote separated from its table by full-height blank rows reads as
floating and is a defect.

4.4 A footnote is **never** a single unmerged cell with wrapped text crushed into one column width — that
is the defect this rule exists to eliminate, and it must not recur on any tab of any workbook.

4.5 Where a footnote names a source (§13), it names the source and the as-of date, not a hedge.

---

## §5 Multi-value cells (the multi-tenant case)

5.1 When one cell holds several parallel values — three tenants, three suites, three expiration dates —
the values are **stacked one per line inside the cell** (embedded newline + `wrap_text`, i.e. the Alt+Enter
look), never joined with `/`, `;`, or `,` into a run-on line.

5.2 The column is sized to the longest single value, not to the concatenation.

5.3 The stack is applied identically wherever the multi-value case occurs — Cover, Executive Summary, Rent
Roll, Lease Summary. Mixing a separator style on one tab and a stacked style on another is exactly the
inconsistency this rule removes.

5.4 In a table where a numeric column (e.g. PSF) sits to the right of a stacked text cell, the stacked
cell's lines align top and the numeric column's value aligns top on the same row, so the row reads as one
record rather than a text block with a number floating beside it.

5.5 Text-only rows sitting below a table that has a numeric column are merged and centered to the table's
text width, so the text block has one consistent measure instead of inheriting the numeric grid.

---

## §6 Banding, borders and fills span the full table

6.1 Alternating row banding is applied to a **rectangle** — (first row, last row) × (first column, last
column) — by one helper. Never per-cell, never per-column.

6.2 A banded row that stops partway across the table is a defect. So is a border that ends before the last
column, or a section fill that covers some of its span.

6.3 The band rectangle's last column is the table's last column, including any trailing PSF / % / notes
column.

6.4 Banding is a property of the table, so a table that gains a column gains it in the band automatically.

---

## §7 Column widths — fixed by role, shared across tabs

7.1 Column widths are read from the `COL_W` registry by role, not written as per-tab literals.

| Role | Key | Width | Notes |
|---|---|---|---|
| Label | `label` | 34 | Left column of a label/value table |
| Text / name | `text` | 28 | Tenant, party, description |
| Currency | `money` | 16 | `$#,##0` |
| Per-SF | `psf` | 12 | `$#,##0.00` — **identical on every tab that has it** |
| Percent | `pct` | 10 | `0.0%` |
| Date | `date` | 12 | `MM/DD/YYYY` |
| Term | `term` | 10 | Years, 1 decimal |
| Note | `note` | 14 | Short qualifier |

7.2 **A column that appears on more than one tab has one width.** The PSF column on the Valuation tab is
the same width as the PSF column on the Executive Summary and the Cover. A reader moving between tabs
should see the same grid.

7.3 A tab needing a width not in the registry adds a ROLE to the registry — it does not hard-code a number.

---

## §8 Alignment

8.1 A column header takes the alignment of the data beneath it: text → left, numeric/currency/percent →
right, date → center.

8.2 Every header in one header row is aligned by its own column's rule, and the same column on another tab
is aligned the same way. A far-right header aligned differently from its siblings — or from the same column
on the previous tab — is a defect.

8.3 Vertical alignment is `center` for single-line roles and `top` for wrapped roles (§3, §5).

---

## §9 Number formats — one format per kind of quantity

9.1 The format is a property of the QUANTITY, not of the tab:

| Quantity | Format | Rendered |
|---|---|---|
| Currency (totals, rent, price) | `$#,##0` | `$17,101,915` |
| Per square foot | `$#,##0.00` | `$356.00` |
| Cap rate / yield / growth | `0.00%` | `8.14%` |
| Variance / share | `0.0%` | `1.7%` |
| Lease term | `0.0` + `" yrs"` | `10.4 yrs` |
| Area | `#,##0` + `" SF"` | `48,041 SF` |
| Multiple | `0.00x` | `1.85x` |
| Date | `MM/DD/YYYY` | `09/30/2035` |

9.2 **Decimals do not vary by tab or by row.** A term stated as `10.4 yrs` on the Lease Summary is not
`10.42` on the Rent Roll and `10` on the Cover.

9.3 Every value carries its unit label or its format — never a bare number whose unit the reader must
infer.

9.4 Term is stated in years. Months appear only where the source document states months, and are then
labeled `mos` explicitly; a months figure never sits unlabeled beside a years figure.

9.5 A field that reads as a monetary summary is formatted as currency. A currency-shaped fact rendered as a
text sentence is a defect (it breaks sorting, math and the eye's scan of the column).

---

## §10 Capitalization

10.1 Section bars: UPPER CASE. Column headers and field labels: Title Case. Values: as recorded in the
source, with obvious capture artifacts (ALL CAPS county strings) title-cased for display only.

10.2 One convention per tab and the same convention across tabs. Mixed capitalization within a field family
is a defect.

---

## §11 Totals and weighted averages

11.1 Every roll-up table — rent roll, expense schedule, rent schedule — ends with a **Total row**.

11.2 Where a straight sum is meaningless (rates, terms, PSF), the row carries a **weighted average**,
labeled `Wtd. Avg.` with the weight named in the label or the footnote (e.g. `Wtd. Avg. (by RSF)`).

11.3 Total rows are `total` height, bold, `TOTBG` fill, banded rectangle's last row.

11.4 A table with more than one record and no total row fails validation.

---

## §12 Helper data is not presentation

12.1 Intermediate calculation grids ("HELPER DATA", lookup ladders, interpolation tables) do not appear in
client-facing table flow.

12.2 They live in a dedicated assumptions/working area, or in a grouped-and-collapsed row range, or on a
later working tab — hidden from the default view.

12.3 The client-facing tab shows the RESULT (the returns, the sensitivity grid) and nothing the reader has
to skip past.

---

## §13 One period, one number — source conflicts

13.1 **Never render two rows for the same period from two sources** (e.g. a Northmarq-estimated 2025 opex
line above a Seller-reported 2025 opex line). One period, one row, one number.

13.2 **Accuracy first, no guesses.** Precedence when both exist:

`Seller / owner actuals` → `audited or tax-assessor record` → `our estimate`

Seller-provided actuals win a tie against our estimate.

13.3 The chosen source is named in the table's footnote with its as-of date.

13.4 Where the two cannot be reconciled and the difference is material, render `Conflict` and surface it —
never average the two, never silently pick one.

13.5 Where a period has no data at all, render `Not on file`. Never interpolate to fill a grid.

---

## §14 Show only the periods you have

14.1 A schedule renders exactly the periods with data. One year of expense history renders ONE year —
not a three-year grid with two empty columns, and not a padded prior year.

14.2 Column count is therefore data-driven; the table's geometry (§6, §7) adapts and the band rectangle
follows.

---

## §15 Tab families mirror each other

15.1 **Expense History · Budget · Pro Forma Economics are one family.** They share:

- one row-label vocabulary (the same expense line is called the same thing on all three),
- one row ORDER,
- one column geometry and one set of column roles,
- one number-format set (§9).

They differ only in periods and values. Pro Forma Economics may be a summarized subset — but every line it
does show uses the family's label, in the family's order, in the family's position.

15.2 The test: a reader's eye should land in the same horizontal position for the same line item when
moving between the three tabs.

15.3 Adding a line item to one member of the family adds it to the family's vocabulary; it does not get a
tab-local name.

---

## §16 List cells (highlights, key risks)

16.1 One spacing convention for the entire table: each item on its own line, single newline between items,
**no trailing blank line** and no leading blank line.

16.2 Every cell in the table follows it. A table where some cells have a blank line after the item and
others do not is a defect.

16.3 Item text is a complete, self-contained statement — no continuation across cells.

---

## §17 Tolerance bands and honest language

17.1 A computed variance inside a named tolerance band renders as **the band's phrase plus the figure**,
not a bare number that implies precision the input does not support.

17.2 Named bands for market-rent comparison:

| Band | Condition | Rendered |
|---|---|---|
| At Market | \|Δ\| ≤ 2.0% | `At Market — 1.7% above consensus` |
| Modestly above / below | 2.0% < \|Δ\| ≤ 7.5% | `Modestly Above Market — 4.9% above consensus` |
| Above / below | \|Δ\| > 7.5% | `Above Market — 11.2% above consensus` |

17.3 The band thresholds are named constants in the generator, not per-deal judgement.

17.4 This is a presentation rule, not a valuation rule: the underlying number is unchanged and still shown.

---

## §18 Cross-format binding (Word · PDF · OM · email)

18.1 The same palette (`NAVY #003DA5`, `PALE #E0E8F4`, `TOTBG #D6E4F5`, `MUTED #6A748C`), the same type
family (Calibri / Calibri Light), and the same 10pt floor apply in every format.

18.2 The same LABEL VOCABULARY is used in all formats — a line called `Per RSF Leased` in the workbook is
`Per RSF Leased` in the OM, the Word memo and the email. No format re-words a field.

18.3 The same number formats (§9), the same source conventions (`Not on file` / `Conflict` / `Derived`,
§13) and the same tolerance language (§17) apply in prose as in tables.

18.4 Tables exported to PDF must render identically to the workbook — which is why heights are computed
(§1.2, §3.3) rather than auto-fit.

18.5 File naming and save location follow `canon/blocks/filing.md` (binding) and
`docs/capital-markets/FILE_HYGIENE_CONVENTIONS.md` — one current master sheet in the property folder base,
prior versions date-named in `Old/`, never a status word in a filename.

---

## §19 Traceability — Round 20 comments → rules

| # | Scott's comment (SSA — Savannah, GA) | Generalized as |
|---|---|---|
| 1 | Cover D30 — long title forces row 30 to a different height; shorten to "Per RSF Leased" | §1.3, §2.1–2.4 |
| 2 | Cover — row heights alternate/differ within a section (rows 31–37 the clearest case) | §1.1 |
| 3 | Cover B66 — footnote crushed into one wrapped cell instead of spanning the table width; floats away from the table | §4.1, §4.3, §4.4 |
| 4 | Cover C64 — three tenants in one cell; pick stacked-lines and apply everywhere | §5.1–5.3 |
| 5 | Cover C60 — summarize to fit one line, no hanging word | §3.2 |
| 6 | Exec Summary rows 7 / 17 / 31 — banding stops halfway across | §6.1–6.3 |
| 7 | Exec Summary C15 — summary hangs by one word | §3.2 |
| 8 | Exec Summary C17 — same three-tenant problem; busy/overlapping next to a PSF column; merge-and-center text-only rows | §5.1, §5.4, §5.5 |
| 9 | Exec Summary C36–37 — text summaries where a currency/number summary was intended | §9.5 |
| 10 | Exec Summary B58 — footnote, as above | §4 |
| 11 | Highlights / Key Risks — inconsistent spacing between items | §16 |
| 12 | Exec Summary row 38 — 1% off market should read "At Market", not a bare variance | §17 |
| 13 | Valuation — PSF column width differs from the same column on other tabs | §7.2 |
| 14 | Valuation D70 — far-right column title aligned differently from its siblings | §8.2 |
| 15 | Sensitivity — HELPER DATA section makes the page busy; move or hide it | §12 |
| 16 | Lease Summary — term decimals vary (2 / 1 / none), some labeled, some in months | §9.2, §9.4 |
| 17 | Lease Summary — capitalization varies across fields | §10 |
| 18 | Rent Roll — missing a building total / average row | §11.1–11.4 |
| 19 | Expense History — only one year of data, so show one year | §14.1 |
| 20 | Expense History — two rows for the same year (Northmarq vs Seller); default to Seller, accuracy first, no guesses | §13.1–13.5 |
| 21 | Budget — layout/formatting consistency; mirror Expense History | §15 |
| 22 | Pro Forma Economics — mirror the family's formatting and titles so the eye tracks across tabs | §15.1–15.3 |

---

## §20 Enforcement

20.1 **Registries and helpers** live in `bov-generator/bov_constants.py`: `ROW_H`, `COL_W`, `LABELS`, and
the helpers `footnote()`, `stack()`, `band()`, `total_row()`, `prose()`. Tab modules call helpers; a tab
module that writes a raw height, width or fill is the defect this standard exists to prevent.

20.2 **A validator** (`bov-generator/validate_presentation.py`, planned — see §21) checks a produced
workbook against §1–§17 and fails naming the tab, the cell and the rule number. It runs as part of master
sheet generation, not as a manual review step.

20.3 **A defect found by review is fixed in the registry/helper, never in the workbook.** A one-off cell fix
is a regression waiting to happen on the next deal — this is the whole reason the standard exists.

---

## §21 Open items (not yet built)

- `validate_presentation.py` — the automated checker for §1–§17. Rules 1.1, 2.2, 3.2, 4.1, 6.2, 7.2, 8.2,
  9.2, 11.4, 14.1 and 16.2 are all mechanically checkable and should fail the build, not a review round.
- Retrofit of the existing tab modules (`bov_tabs_*.py`, `mob_tab_*.py`) onto the helpers — they currently
  set heights and widths inline, which is why the defects in §19 vary tab by tab.
- Word / PDF / OM / email renderers bound to §18 (the label vocabulary is currently re-typed per format).
- The SSA — Savannah, GA workbook has NOT yet been re-run against this standard (the property folder was
  not reachable when the standard was written).
