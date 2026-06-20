# Claude Code prompt — Canonical lease-comps template: merge best-of + align to the dialysis export

> Scott's directive: merge the best parts of the lease-comps template variants into ONE canonical
> template that **aligns with the deployed dialysis lease-comps export** (the "Export Lease Comps"
> button on the property page). My best-judgment merge decision is below — execute it as a
> coordinated change (template generator + export column-map/data-writer + framework convergence).
> Receipts-first; gated; this touches DEPLOYED export code — preserve every ExcelJS-compat fix.

## Grounding (the canonical base = the deployed dialysis export)
`scripts/build_lease_comps_template.py` generates `assets/cm-templates/dialysis-lease-comps-template.xlsx`,
which the property-page export populates (`_udExportLeaseComps` in `detail.js`, col-map in
`detail-lease-comps-fix.js` `_UD_TABLE_COL_MAP`, data from the dialysis lease-comps query). It is
the live standard and already the fullest variant (23 cols A–W: TENANT/OPERATOR/ADDRESS/CITY/ST/
LAND/BUILT/RENO/RBA/SF LEASED/OCCUPANCY/RENT/SF/CURRENT RENT/COMM/EXP/INITIAL TERM/TERM REM/
EXPENSES/BUMPS/USER-OWNER/DISTANCE TO SUBJECT/PATIENTS), with the `Comps` table (B7:W60), the
AVERAGE row, `=A+1` numbering, and the rels-path + ExcelJS-compat patches.

## The merge decision (execute exactly)
Add the three genuinely-useful columns the export lacks (from the CVS Philadelphia variant);
keep all dialysis specifics; drop PROPERTY USE (redundant for all-dialysis). New 26-col order
(insert LEASE TYPE after TERM REM, OPTIONS after BUMPS, NOTES at the end after PATIENTS):

`# | TENANT | OPERATOR | ADDRESS | CITY | ST | LAND | BUILT | RENO | RBA | SF LEASED | OCCUPANCY |
RENT/SF | CURRENT RENT | COMM | EXP | INITIAL TERM | TERM REM | LEASE TYPE | EXPENSES | BUMPS |
OPTIONS | USER/OWNER | DISTANCE TO SUBJECT | PATIENTS | NOTES`

- **LEASE TYPE** (col S) — text `@`, e.g. NNN / NN / Gross / Modified Gross.
- **OPTIONS** (col V) — text `@`, renewal-option summary.
- **NOTES** (col Z) — text `@`, free-text.
- DISTANCE TO SUBJECT + PATIENTS stay (dialysis-specific haversine + patient count); they shift
  right by the inserted columns — update LAST_COL_LETTER/INDEX (→ Z / 26), the brand-band + section
  spans, the `Comps` table ref (→ B7:Z<total>), and the AVERAGE row.

## Coordinated changes (all must move together)
1. **`build_lease_comps_template.py`** — extend `COLUMNS` with the 3 new entries in the order
   above; update widths/number-formats, `LAST_COL_LETTER`/`LAST_COL_INDEX`, the row-1 brand band +
   section-band merges, the `Comps` table `ref`, and the `avg_formulas` (no AVERAGE for the 3 new
   text columns). Preserve `=A+1` numbering, freeze `B8`, `print_title_rows`, and the
   `_patch_rels_paths` ExcelJS fix. Regenerate the template.
2. **Export wiring** — update `_UD_TABLE_COL_MAP` (`detail-lease-comps-fix.js`) and the export
   data-writer (`_udExportLeaseComps` / the dialysis lease-comps query) so the export POPULATES
   LEASE TYPE (from `leases.lease_type`), OPTIONS (from the lease options/renewal field if
   available, else blank), and NOTES (blank/`leases.notes` if present). Columns the data layer
   can't fill yet render blank (honest) — do NOT fabricate. The `Comps[<NAME>]` structured refs
   must match the new header cell values exactly.
3. **Framework convergence** — make the Work-Product Framework's lease-comps template THIS
   canonical generator/output (the dialysis export template), and **retire the two redundant
   variants** in `assets/work-product-templates/comps/` (`Briggs_LeaseComps_TEMPLATE.xlsx` [CVS]
   and `Lease Comps Template - Briggs.xlsx` [cm-templates]) — keep one canonical + the
   `protected_columns.json` registry (RENT/SF, TERM[/INITIAL TERM/TERM REM], DOM, EFFECTIVE
   RENT/SF remain the no-touch set; the 3 new text columns are not formula-protected).

## Flag for Scott (don't fix without his call)
- **Font discrepancy:** the dialysis export uses **Trebuchet MS / Open Sans** (the `detail.js`
  NMQ_BRAND), while the Work-Product Framework's `work_product_base` standardized on **Calibri
  Light / Calibri** (per `cm_brand_tokens.json` "Excel reality"). Two different brand-font stacks
  now coexist across deliverables. Surface this — pick ONE canonical font stack so all work
  products match. Do not silently change the deployed export's fonts.

## My gate
- Regenerated template opens cleanly in Excel AND via ExcelJS (the rels patch holds); has the 26
  merged columns in order; `=A+1` numbering, `Comps` table, and AVERAGE row intact; LEASE TYPE/
  OPTIONS/NOTES present.
- The live export button still works end-to-end and now emits the 3 new columns (populated where
  data exists, blank otherwise — no fabrication), DISTANCE/PATIENTS intact in their shifted
  positions.
- Exactly ONE canonical lease-comps template remains; the two redundant variants removed; the
  protected-column registry updated.

## Guardrails
- Receipts-first; gated; preserve every ExcelJS-compat fix (rels paths, no Subject table, explicit
  AVERAGE formulas) — these were hard-won (Round 76gn.* notes). Don't fabricate data for the new
  columns. Single canonical template aligned to the deployed export. ≤12 api/*.js. Deliver the
  regenerated template + a sample export for the gate.
