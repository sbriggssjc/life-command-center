# Prompt 35 Worklog - Deliverable Naming + Save Location Doctrine

Date: 2026-08-04

## Objective

Codify one filename and save-location doctrine for all Northmarq deal artifacts so BOVs, VAMs, Master Sheets,
sales comps, lease comps, OMs, and LOIs land in the same deal folder and use the same stem.

## Canonical Rule

- Filename stem: `{Property}_{DocType}_{Client}_{YYYYMM}`
- DocType vocabulary: `VAM`, `MasterSheet`, `SalesComps`, `LeaseComps`, `BOV`, `OM`, `LOI`
- Shared-drive save target: `Team Briggs - Documents/Deals/{Client}/{Property}/`
- Repo-local fallback: `outputs/deals/{Client}_{Property}/`

## Changes

- Bumped `Team Briggs - Documents/_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md` to v1.12 and replaced the old mixed
  file naming section with the deliverable naming + save-location doctrine.
- Mirrored the rule into `docs/comps-rollout/comps-engine-SKILL.md`.
- Mirrored the rule into the repo BOV canon (`docs/os/canon/bov.md`) and the BOV/comps Project action contract
  (`bov-generator/claude_project_action.json`). The external Claude skill files `bov-underwriting` and
  `bov-government` are referenced by the repo but were not present as editable files in this workspace.
- Added a paste-ready BOV skill block to `SPEC_Capability_Parity.md` for the external `bov-underwriting` skill
  path if Scott exposes that file later.
- Updated `docs/comps-rollout/northmarq-claude-project-setup.md` with the canonical prompt pointer and save target.
- Updated `bov-generator/main.py` so generated BOV and comps workbook filenames follow the doctrine mechanically.

## Verification Notes

- Target test property/client: `7912 Cameron Rd, Austin, TX` / `Ward` / `202608`.
- Expected BOV: `7912_Cameron_Rd_Austin_TX_BOV_Ward_202608.xlsx`
- Expected sales comps: `7912_Cameron_Rd_Austin_TX_SalesComps_Ward_202608.xlsx`
- Expected lease comps: `7912_Cameron_Rd_Austin_TX_LeaseComps_Ward_202608.xlsx`
- Expected VAM memo: `7912_Cameron_Rd_Austin_TX_VAM_Ward_202608.docx`
