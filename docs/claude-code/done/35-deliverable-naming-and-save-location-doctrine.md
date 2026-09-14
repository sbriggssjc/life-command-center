# Prompt 35 — Deliverable naming + save-location doctrine (make every deal artifact land right)

## Why (found 2026-08-04, Northmarq DaVita/Austin test chat)
The deal produced good content but two plumbing misses:
- **Inconsistent naming.** The VAM followed convention — `7912 Cameron Rd_Austin_TX_VAM_Ward_202608.docx` — but
  the Master Sheet came out as `DaVita  Austin TX Master Sheet.xlsx` (no client, no month, double space, spaces
  not underscores). Two artifacts from one deal, two different naming schemes.
- **No save target.** "Moved to outputs" meant the session's scratch outputs; the artifacts reached Scott only as
  chat attachments. The repo's `outputs/` holds only `daily-briefing-logs`; there is no canonical client-
  deliverable folder wired, and the run wasn't saving to disk.

## Canonical rule to codify
**Filename:** `{Property}_{DocType}_{Client}_{YYYYMM}.{ext}`
- `{Property}` = street-anchored, `_`-joined (e.g. `7912_Cameron_Rd_Austin_TX`). No double spaces, no commas.
- `{DocType}` ∈ `{VAM, MasterSheet, SalesComps, LeaseComps, BOV, OM, LOI}` (extend as needed, PascalCase, no spaces).
- `{Client}` = client last name / short org (e.g. `Ward`).
- `{YYYYMM}` = file month (deal month), e.g. `202608`.
- Applies to **every** artifact in a deal, Master Sheet included. Example set for this deal:
  `7912_Cameron_Rd_Austin_TX_MasterSheet_Ward_202608.xlsx`, `..._VAM_Ward_202608.docx`,
  `..._SalesComps_Ward_202608.xlsx`, `..._LeaseComps_Ward_202608.xlsx`.

**Save location:** finished deliverables for a deal save to one deal folder, not scattered. Define/confirm the
canonical path convention (proposed: `Team Briggs - Documents/Deals/{Client}/{Property}/` on the shared drive, or
a repo-local `outputs/deals/{Client}_{Property}/` when running on-computer) and write the whole deliverable set
there with the names above. When a run can save to disk (on-computer), it saves; when it can't (managed/cloud),
it says so and still names the attachments to the convention.

## Task
1. **Update the canonical Northmarq Project prompt** — `Team Briggs - Documents/_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md`
   (v-bump per its own maintenance header): add a "Deliverable naming + save location" section with the rule above,
   binding on every artifact. If a repo-tracked copy exists, edit it; otherwise emit the exact paste-ready block +
   new version number for Scott to paste (the doc is the single source of truth — never edit the Project directly).
2. **Mirror the rule** into the two comps/BOV skills so it's identical across surfaces: `comps-engine` SKILL and the
   BOV skill(s). Same `{Property}_{DocType}_{Client}_{YYYYMM}` string, same DocType vocabulary.
3. **Update the mechanical setup doc** `docs/comps-rollout/northmarq-claude-project-setup.md`: add a one-line note
   that the naming/save doctrine lives in the canonical prompt, and add a save-target line to the "Boundary" section.
4. Keep the compose-and-hand-off design intact (the Northmarq project has no live connector by design until an admin
   adds it — see prompt 33). This prompt is about naming + where files land, not about the connector.

## Verify
- Re-run the Northmarq test (small comp export + a mock BOV request): both the workbook and the memo come out named
  to `{Property}_{DocType}_{Client}_{YYYYMM}`, and the instructions state exactly where the set saves.
- The naming string is byte-identical in the canonical prompt, the setup doc, and both skills (grep to confirm).
- No fabrication rules weakened; compose-and-hand-off to /comps + /bov unchanged.
