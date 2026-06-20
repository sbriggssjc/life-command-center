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

- `Lease Comps Template - Briggs.xlsx` — the Briggs lease-comps template (header
  bands on rows 3 + 7, `=A+1` numbering). Restyled in place by E2.
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
