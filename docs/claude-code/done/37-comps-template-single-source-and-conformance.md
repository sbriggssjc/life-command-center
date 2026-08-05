# Prompt 37 — Comps: single-source the templates + a conformance validator

## Why (found 2026-08-04)
The blank comps template exists in several places that can drift: `bov-generator/templates/*.xlsx` (the renderer's
source), copies uploaded to the Northmarq/Copilot project knowledge, and the `Templates/` folder. Nothing checks
that a produced workbook actually conforms to the standard, so divergent outputs shipped unnoticed.

## Task
1. **Declare `bov-generator/templates/` the single source of truth** for all comps blank templates (sales, lease,
   dialysis, government). The project-knowledge and `Templates/` copies are DERIVED — document that they are
   synced from `bov-generator/templates/`, never hand-edited (same discipline as the canon/render system). Add a
   short sync note / script so refreshing the distributed copies is one command.
2. **Add a conformance validator** — `bov-generator/validate_comps_output.py` (and/or a test) that opens a
   produced comps `.xlsx` and asserts:
   - sheet set == {Cover, Index, On Market, Sold} (sales) — exact names;
   - header row (row 5) matches the canonical column list for that vertical (dialysis includes CHAIRS/PATIENTS);
   - formula-protected columns (RENT/SF, SOLD/SF, SOLD CAP, TERM, INITIAL/LAST CAP, BID-ASK, PRICE CHG, DOM) still
     hold formulas, not literals;
   - the AVG/TOTALS bar sits directly beneath the last data row (trim applied) and its AVERAGE/COUNT ranges match
     the row count;
   - recalc reports 0 errors.
   Return pass/fail + the specific violations.
3. **Wire it into the export path**: `generate_comps` (and the local fallback) run the validator before returning;
   a non-conforming workbook is an error, not a delivered file.

## Verify
- Validator PASSES on a freshly generated dialysis workbook and FAILS on a hand-rolled one (wrong sheets / blank
  CHAIRS / untrimmed grid / literal in a formula column).
- Docs state the single-source rule; the distributed template copies are marked derived.
