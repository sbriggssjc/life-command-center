# Prompt 43 — Comps template/renderer polish: OPTIONS header + auto-fit columns

## Why (Scott's export notes, 2026-08-05)
"Rename RENEWAL OPTIONS to OPTIONS to keep the cell narrower," and "auto-space each column to fit its contents
without wrapping, and match that width across the On Market and Sold tabs." These are template/renderer changes so
every generated workbook comes out this way — not a per-export hand fix.

## Task
1. **Header rename** in the canonical blank templates (`bov-generator/templates/Comps Blank Template - Briggs*.xlsx`,
   dialysis + gov + standard): `RENEWAL OPTIONS` → `OPTIONS` on both On Market and Sold. Keep the column's alias
   mapping (`renewal_options`/`options` → OPTIONS) so populate_comps still fills it. Re-run the template sync
   (`sync_comps_templates.py`) so distributed copies update.
2. **Auto-fit + no-wrap in `populate_comps`.** After writing rows and trimming, size every column to its longest
   cell/header (with small padding, sane max), set `wrap_text=False` on all cells, and **use one shared width per
   header across the On Market and Sold sheets** so the two tabs line up. Dates measured at display width.
3. Keep it inside the renderer so the conformance validator (prompt 37) can also assert "no wrapped cells / widths
   fit contents."

## Verify
- A generated workbook shows the header `OPTIONS` (not RENEWAL OPTIONS), no wrapped text, and identical column
  widths for shared columns between On Market and Sold.
