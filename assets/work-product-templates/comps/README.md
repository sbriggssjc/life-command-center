# Work-Product Templates — Comps (canonical source)

Source-of-truth Excel templates for the Briggs / Northmarq **sales-comps** and
**lease-comps** work products. The Work-Product Framework Slice E2 chrome restyle
reads templates from this folder and routes their title / header / zebra / footer
chrome through the shared `work_product_base` grammar (Dialysis
`src/comps_restyle.py`), so all five work-product types look substantially
similar.

## Restyle contract (the gate)

- **Restyle chrome only.** The restyle changes fonts / fills / borders / row
  heights and adds title + footer text into empty cells. It writes **no cell
  value or formula** and never inserts/deletes rows — so the `=A+1` numbering
  formulas and every relative reference survive intact.
- **Formula-protected columns are never touched** in value / formula /
  number_format. See `protected_columns.json` (Scott, 2026-06-20):
  - **Sales** — RENT/SF, CAP RATE, PRICE/SF, TERM, DOM
  - **Lease** — RENT/SF, TERM, DOM, EFFECTIVE RENT/SF

  Matching is by header-token containment, normalized upper, so `INITIAL TERM`
  and `TERM REM` both match the protected `TERM`.

## Files

- `Lease Comps Template - Briggs.xlsx` — the canonical Briggs lease-comps
  template (header bands on rows 3 + 7, `=A+1` numbering, Comps Excel table,
  AVERAGE row). **This is a generated mirror of the deployed dialysis export
  template** — it is (re)written by `scripts/build_lease_comps_template.py`,
  which emits BOTH `assets/cm-templates/dialysis-lease-comps-template.xlsx`
  (the file the property-page "Export Lease Comps" button populates) AND this
  file, so the framework template never drifts from the live export. Do not
  hand-edit — regenerate via the build script.
  - Canonical-merge (2026-06-20): 26 columns A..Z; the three merged text
    columns LEASE TYPE (S) / OPTIONS (V) / NOTES (Z) are NOT formula-protected.
    The two legacy `Lease Comps Template - Briggs.xlsx` variants (the
    `assets/cm-templates/` copy and an older CVS-Philadelphia variant) were
    retired in favor of this single canonical generator output.
- A sales-comps template should be dropped here when available; the restyler's
  sales path + protected-column registry already cover it (unit-tested), and the
  sheet is auto-classified as `sales` by title (`sale|sold|on-market`).

## Run

```bash
# from the Dialysis repo (where src/work_product_base.py + src/comps_restyle.py live)
python3 scripts/_e2_gate_verify.py \
  "<repo>/assets/work-product-templates/comps/Lease Comps Template - Briggs.xlsx" \
  build/E2_lease_comps_restyled_sample.xlsx
```
