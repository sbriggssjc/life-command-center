# Prompt 34 — Regenerate the blank BOV master template (kill the DSCR bug at its source)

## Why (found 2026-08-04, Northmarq DaVita/Austin test chat)
A live deal chat opened the **blank BOV master template** (the `.xlsx` the Northmarq/Team Briggs project starts
from) and found a real bug: the **DSCR / DCR (Year 1)** cell had a stray empty-string argument inside an `OR()`
that silently blanked the metric. The chat one-off-patched its own copy and flagged the master to fix.

**Key finding:** the source-of-truth generator is already correct. In `bov-generator/bov_tabs_8_assumptions.py`
(and the MOB variant `mob_tab_9_assumptions.py`) the DCR formula reads:
`=IFERROR(IF(OR(C33="",I14="",I14=0),"",C33/I14),"")` — no stray `""`. That means the **blank .xlsx template
uploaded to the Claude/Copilot projects is a stale, hand-built copy that drifted from the generator.** The durable
fix is not a one-cell patch — it is to regenerate the blank template from `bov-generator` so the project always
starts from the generator's known-good formulas.

## Task
1. Confirm the generator emits a *blank* (unpopulated, formulas-intact) workbook, not one that requires a record.
   `build_bov_nnn.py` / `build_bov_mob.py` build populated BOVs from a record; check whether a blank/template mode
   exists (e.g. a null/empty record path) — if not, add a small `--blank` (or `emit_template()`) path that runs
   every `bov_tabs_*` builder with empty inputs so all formula cells are written but value cells are left blank
   (the "Blue text/fill = enter value here" convention already in the sheets).
2. Emit both blanks: **NNN** and **MOB/MT**. Verify the DCR/DSCR formulas match the generator source and recompute
   with LibreOffice/openpyxl to confirm **zero formula errors** on an empty workbook.
3. Diff the regenerated blank against the currently-uploaded template to enumerate every drifted cell (DSCR + any
   others). Record the drift list in a short worklog (`PROMPT_34_WORKLOG.md`) so we know what the stale template
   was getting wrong beyond DSCR.
4. Deliver the two regenerated blank templates as files (do not overwrite the team's uploaded copies silently —
   Scott replaces the project-knowledge uploads and any `Templates/` copies).

## Guardrails
- Formula-protected columns/cells stay formulas — never hardcode a computed value into a template cell.
- Fill-blanks discipline: value cells blank, formulas intact. No sample/placeholder numbers baked in.
- Reversible: keep the old template; deliver new alongside, with the drift worklog.

## Verify
- Open each regenerated blank: DCR (Year 1) = `...OR(C33="",I14="",I14=0)...`, no stray `""`; recompute = 0 errors.
- Going-In Cap, Price/SF, Implied Ask, EGR, NOI, Total Expenses formulas all present and error-free when empty.
- Worklog lists every cell that differed from the stale uploaded template.
