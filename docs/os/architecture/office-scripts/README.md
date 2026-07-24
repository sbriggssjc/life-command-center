# Office Scripts — workbook edits Work IQ can't do (>5 MB / cell-level)

These run the Document Assembly Agent's actual workbook edits. Work IQ SharePoint caps file read/write at
5 MB and can't touch cells; Office Scripts + the Excel Online (Business) connector do both, server-side.

## `apply-lease-escalation.ts`
Writes a property's real contractual rent schedule into a pro-forma Master Sheet — the Broken Arrow Dollar
General fix (replace the fake 1.9% with the actual lease steps). Enforces canon (`../../canon/bov.md`): it
refuses to run without a supplied schedule, so no assumed rate can slip in.

### Install + wire (one time)
1. Open the Master-Sheet workbook in Excel on the web → **Automate → New Script → Create in Code Editor** →
   paste `apply-lease-escalation.ts` → Save (it lands in your OneDrive/SharePoint Office Scripts).
2. In Power Automate, build a flow: trigger (or called by the Deal Agent) → **Excel Online (Business) → Run
   script from a SharePoint library** → pick the workbook + this script → map the inputs from the LCC record
   (the flow pulls the real lease steps from LCC; the script only writes them).
3. The Document Assembly Agent (Copilot) invokes that flow. After it runs, log the change to Cortex.

### Notes
- Absolute references only (script uses `getWorksheet`/`getRange`/`getRangeByIndexes`) — required because the
  workbook is edited with no active selection.
- Requires a business M365 license (you have it).
- Confirm the actual Master-Sheet layout (`sheetName`, `annualRentCell`, `orientation`) once per template.
