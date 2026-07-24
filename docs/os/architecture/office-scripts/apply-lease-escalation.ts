/**
 * apply-lease-escalation.ts — Office Script (run via Power Automate: Excel Online (Business) → "Run script
 * from a SharePoint library"). Writes a property's ACTUAL contractual rent escalation schedule into a
 * BOV / pro-forma Master Sheet, replacing any assumed flat % growth (the Broken Arrow Dollar General fix).
 *
 * Canon: docs/os/canon/bov.md — "lease terms before assumptions." This script only WRITES the schedule it is
 * given by the flow (sourced from the LCC record / lease). It NEVER invents an escalation — if `steps` is
 * empty it throws, so a fabricated growth rate can't slip in here.
 *
 * Power Automate integration: the flow pulls the real rent steps from LCC, then calls this script on the
 * workbook in SharePoint. Use ABSOLUTE references only (getWorksheet by name / getRange by address) — the
 * workbook is edited server-side with no active selection.
 *
 * INPUTS (flow parameters):
 *   sheetName          the pro-forma worksheet name (e.g. "Pro Forma")
 *   annualRentCell     top/left cell of the annual base-rent schedule row/column (e.g. "D12")
 *   orientation        "row" (years across columns) | "column" (years down rows)
 *   steps              [{ periodLabel: string, annualRent: number }] — contractual schedule, in order
 *   clearFormulasFirst if the fake escalation was a formula fill, clear the target range before writing
 *   sourceNote         provenance (lease id / section) — stamped for audit
 *   notesCell          optional cell to stamp the provenance note
 *
 * RETURNS { written, firstCell, lastCell } so the flow can confirm and log to Cortex.
 */
function main(
  workbook: ExcelScript.Workbook,
  sheetName: string,
  annualRentCell: string,
  orientation: "row" | "column",
  steps: { periodLabel: string; annualRent: number }[],
  clearFormulasFirst: boolean,
  sourceNote: string,
  notesCell?: string
): { written: number; firstCell: string; lastCell: string } {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`Worksheet '${sheetName}' not found.`);
  if (!steps || steps.length === 0) {
    // Enforce the canon rule at the point of write: no schedule → refuse, never guess.
    throw new Error("No contractual escalation steps supplied — refusing to write an assumed rate.");
  }

  const start = sheet.getRange(annualRentCell);
  const startRow = start.getRowIndex();
  const startCol = start.getColumnIndex();
  const count = steps.length;

  const targetRange = orientation === "row"
    ? sheet.getRangeByIndexes(startRow, startCol, 1, count)
    : sheet.getRangeByIndexes(startRow, startCol, count, 1);

  if (clearFormulasFirst) {
    targetRange.clear(ExcelScript.ClearApplyTo.contents);
  }

  const values = orientation === "row"
    ? [steps.map(s => s.annualRent)]
    : steps.map(s => [s.annualRent]);
  targetRange.setValues(values);

  if (notesCell && sourceNote) {
    sheet.getRange(notesCell).setValue(`Rent schedule from lease: ${sourceNote} (applied by Office Script)`);
  }

  const firstCell = targetRange.getCell(0, 0).getAddress();
  const lastCell = targetRange
    .getCell(orientation === "row" ? 0 : count - 1, orientation === "row" ? count - 1 : 0)
    .getAddress();

  return { written: count, firstCell, lastCell };
}
