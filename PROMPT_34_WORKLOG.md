# Prompt 34 Worklog - Regenerate Blank BOV Master Templates

Date: 2026-08-04

## Objective

Regenerate the blank BOV master templates from `bov-generator` so the Team Briggs project starts from generator-owned formulas instead of stale hand-built `.xlsx` copies. Specific target: remove the DCR/DSCR Year 1 drift where a stale template had an invalid `OR(...,"")` pattern or no generator DCR cell at all.

## Generator Path Confirmed

- `bov-generator/build_bov_nnn.py` creates a blank NNN workbook directly from tab builders. It does not require a deal record.
- `bov-generator/build_bov_mob.py` creates a blank MOB/MT workbook directly from tab builders. It does not require a deal record.
- No `--blank` code path was needed because both assembly scripts already emit blank, formulas-intact workbooks.
- The first attempted run failed only because Windows PowerShell could not encode the progress arrow in the script output. Rerunning with `PYTHONIOENCODING=utf-8` generated both workbooks cleanly.

## Delivered Files

- `outputs/prompt_34_bov_templates/BOV_Master_NNN_Briggs_BLANK_2026-08-04.xlsx`
- `outputs/prompt_34_bov_templates/BOV_Master_MOB_MT_Briggs_BLANK_2026-08-04.xlsx`
- `outputs/prompt_34_bov_templates/prompt_34_stale_drift.csv`
- `outputs/prompt_34_bov_templates/prompt_34_verify.json`
- `outputs/prompt_34_bov_templates/prompt_34_artifact_verify.json`

## Formula Verification

NNN key formulas matched generator source:

- `Assumptions & Flags!I16` DCR Year 1: `=IFERROR(IF(OR(C33="",I14="",I14=0),"",C33/I14),"")`
- `Assumptions & Flags!C19` Implied Ask Price: `=IFERROR(IF(OR(C33="",C16="",C16=0),"",C33/C16),"")`
- `Assumptions & Flags!C27` EGR: `=IFERROR(IF(C24="","",C24+IFERROR(C26,0)),"")`
- `Assumptions & Flags!C32` Total Expenses: `=IFERROR(IF(C24="","",C24*IFERROR(C30,0)+IFERROR(C31,0)),"")`
- `Assumptions & Flags!C33` Estimated NOI: `=IFERROR(IF(C27="","",C27-C32),"")`
- `Assumptions & Flags!C37` Going-In Cap Rate: `=IFERROR(IF(OR(C33="",C36="",C36=0),"",C33/C36),"")`
- `Assumptions & Flags!C38` Price Per SF: `=IFERROR(IF(OR(C36="",C9="",C9=0),"",C36/C9),"")`

MOB/MT key formulas matched generator source:

- `Assumptions & Flags!I16` DCR Year 1: `=IFERROR(IF(OR(C85="",I14="",I14=0),"",C85/I14),"")`
- `Assumptions & Flags!C91` Implied Asking Price: `=IFERROR(IF(OR(C85="",C88="",C88=0),"",C85/C88),"")`
- `Assumptions & Flags!C83` EGI: `=IFERROR(IF(C81="","",C81+IFERROR(C82,0)),"")`
- `Assumptions & Flags!C84` Total Operating Expenses: `=IFERROR(IFERROR(C69,0)+IFERROR(C70,0)+IFERROR(C71,0)+IFERROR(C83,0)*IFERROR(C72,0)+IFERROR(C73,0)+IFERROR(C74,0)+IFERROR(C75,0)+IFERROR(C76,0),"")`
- `Assumptions & Flags!C85` NOI: `=IFERROR(IF(C83="","",C83-IFERROR(C84,0)),"")`
- `Assumptions & Flags!C95` Going-In Cap Rate: `=IFERROR(IF(OR(C85="",C94="",C94=0),"",C85/C94),"")`
- `Assumptions & Flags!C96` Price Per SF: `=IFERROR(IF(OR(C94="",C9="",C9=0),"",C94/C9),"")`

Formula inventory:

- NNN generated blank: 861 formula cells.
- MOB/MT generated blank: 1,235 formula cells.

Error scan:

- LibreOffice recalc could not run on this workstation because `soffice` is not installed.
- Openpyxl verified workbook formulas and key formula text directly.
- The bundled spreadsheet runtime imported/calculated both generated workbooks, rendered every sheet, and found zero formula-error matches for `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`, `#NULL!`, and `#NUM!`.

## Stale Template Drift

Compared regenerated NNN blank against the two local workflow masters:

- `C:\Users\scott\OneDrive - NorthMarq Capital, LLC\Team Briggs - Documents\_WORKFLOW\BOV_Master_NNN_Briggs.xlsx`: 1,214 cell-level differences.
- `C:\Users\scott\OneDrive - NorthMarq Capital, LLC\Team Briggs - Documents\_WORKFLOW\BOV Master Sheet - Briggs.xlsx`: 1,147 cell-level differences.

Full cell-by-cell drift list is in:

- `outputs/prompt_34_bov_templates/prompt_34_stale_drift.csv`

Material drift observed beyond the DSCR/DCR issue:

- Stale workflow masters are not just generator workbooks with one bad formula; they are older hand-built layouts.
- Generator adds/keeps full tabs missing in stale workflow masters, including `Amortization` and `Sensitivity Analysis`.
- DCR Year 1 is generator-owned at `Assumptions & Flags!I16`; the stale workflow masters had no formula at that cell.
- One stale NNN workflow master had the bad empty-string `OR()` pattern at `Assumptions & Flags!C39`: `=IFERROR(IF(OR(C37="",C37=0,""),"",C9/C37),"")`.
- Major assumption-map drift exists across pricing, debt, disposition, pro forma, rent schedule, and return-summary formulas. The generator version relocates assumptions into the current two-column `Assumptions & Flags` map and rewires downstream formulas to that map.
- Stale workflow masters contained baked default inputs such as 10-year hold, 65% LTV, 6.5% interest rate, and 25-year amortization. The regenerated blanks leave value-entry cells blank and preserve formulas.

## Current Status

Complete. The old workflow masters were not overwritten. Scott should replace project-knowledge uploads and any team `Templates/` copies with the two regenerated blank workbooks above.
