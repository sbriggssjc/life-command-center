# Prompt 48 — Comps builder: make the shared-width contract survive LibreOffice recalc

## Why (live connector acceptance test, 2026-08-05 — post-46 verify)

Prompt 46 landed (PR #1565): the overflow cap, trim-on-every-path, and the shared
width contract in `validate_comps_output.py` all work. But `generate_comps` STILL
500s on conformance:

```
Comps service returned HTTP 500: {"error":"produced comps workbook failed conformance",
 "violations":["shared column widths differ between On Market and Sold: [('PATIENTS', 10.0, 13.0)]"]}
```

**Root cause (reproduced end-to-end, not theorized).** The width contract is applied
by `comps_generator._autofit_no_wrap` (openpyxl) and it IS correct — a shared column
gets ONE width across both sheets *before* save. But the export path then runs
`recalc_and_validate` (`recalc_runner.py` → LibreOffice `ThisComponent.calculateAll()` +
`ThisComponent.store()`), and **LibreOffice re-optimizes column widths when it stores
the file**, even for columns openpyxl wrote with `customWidth="1"`. A shared column
that is *populated on one sheet but blank on the other* desyncs: `PATIENTS` is blank
on On Market (LibreOffice leaves the header floor → 10.0) but has counts on Sold
(LibreOffice fits to content → 13.0). The conformance gate at `main.py::generate_comps`
runs **after** recalc (`validate_comps_file(..., check_recalc_errors=True)`), so it sees
the desynced post-recalc widths and fails. Prompt 46's contract is correct but recalc
gets the last word.

Exact reproduction (merged `main`, real LibreOffice recalc): build a dialysis workbook
with On Market rows that have no patient counts and Sold rows that do → `_autofit_no_wrap`
saves PATIENTS at 10.0 / 10.0 (matched, passes) → LibreOffice `calculateAll`+`store`
rewrites Sold PATIENTS to 13.0 → validator reports `('PATIENTS', 10.0, 13.0)`. Any
shared column asymmetrically populated (blank on one sheet, filled on the other) can
desync the same way; PATIENTS is just the reliable trigger because listings never carry
patient counts.

## Task

**Re-apply the shared-width contract AFTER recalc, as the LAST write before validation —
without dropping the cached formula values recalc just computed.**

The constraint that makes this non-trivial: re-opening the recalc'd workbook with openpyxl
and re-saving would strip LibreOffice's cached formula results (openpyxl writes formulas
but no cached values), so the delivered file would show blanks until the user recalcs, and
the validator's recalc-error check (check 5, `data_only`) would read `None` everywhere.
So DO NOT round-trip the whole workbook through openpyxl after recalc.

Pick the approach that preserves cached values:

1. **Preferred — surgical `<cols>` rewrite.** After `recalc_and_validate` returns, rewrite
   ONLY the `<cols>` column-width definitions inside the recalc'd `.xlsx` (edit the sheet
   XML in the zip in place, or via a values-preserving path) to the shared-width contract
   computed from the now-recalc'd content, using the SAME `validate_comps_output` helpers
   (`disp_len`, `min_content_width`, `target_column_width`) the renderer/validator already
   share — so On Market and Sold get identical widths for every shared header and every
   column still fits. Leave every cell value and cached result untouched. Then validate.

   Note: measuring the *recalc'd* content is a bonus — formula columns (RENT/SF, caps, TERM,
   DOM) now hold cached values, so `disp_len` measures their real rendered width instead of
   the pre-recalc floor. Keep the computed-column floor as a lower bound.

2. **Alternative — do the width pass inside the recalc macro.** Extend the StarBasic macro
   (or add a second macro pass) so that AFTER `calculateAll()` and BEFORE `store()` it sets
   each comps column's width so shared columns match across On Market and Sold, then stores
   once. LibreOffice then writes both the cached values and the final widths. (Only viable
   if the shared-width math can be expressed in Basic or passed in; the surgical XML rewrite
   is simpler and keeps ONE width authority in Python.)

Whichever path: the widths the conformance validator sees must be the shared-contract widths,
computed once, applied to both sheets, as the final mutation before `validate_comps_file`.

Also apply the same post-recalc width pass on the BOV/lease single-sheet path only if it has
the analogous issue — otherwise leave it; this bug is specific to the two-sheet shared-width
requirement.

## Verify

- Reproduce the current failure first: dialysis build, On Market rows without patient counts +
  Sold rows with them, run the FULL export path incl. a real LibreOffice `calculateAll`+`store`,
  and confirm the pre-fix workbook fails conformance with `('PATIENTS', 10.0, 13.0)` (or the
  equivalent post-recalc desync).
- After the fix, the SAME build passes: `generate_comps` (one-shot AND two-step, dialysis +
  standard) returns a workbook with no 500; shared columns (PATIENTS, CHAIRS, EXPENSES, BUMPS,
  RENT/SF, TERM, caps, DOM …) have identical widths on On Market and Sold; every column fits its
  rendered content; and the delivered file still carries LibreOffice's cached formula values
  (RENT/SF, $/SF, caps, TERM, DOM display computed numbers, not blanks — the recalc-error check
  still reads real cached values, not `None`).
- Live: `generate_comps` for "The Villages DaVita — 1050 Old Camp Rd, The Villages FL" returns a
  conforming workbook (no conformance 500).
