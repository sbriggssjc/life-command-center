# Flow Detail: ToDo-LCCSync

Last updated: 2026-05-11
Flow export: `ToDo-LCCSync_20260511215037.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Run hourly sync aggregation of Microsoft To Do folders and update a OneDrive-hosted sync file/artifact used by LCC workflows.

## Trigger
- Type: `Recurrence`
- Frequency: `Hour`
- Interval: `1`
- Start time observed: `2026-02-17T16:00:00Z`

## High-Level Action Topology
1. Initialize accumulator variable(s).
2. Load target file metadata/path from OneDrive.
3. Repeated `List_to-do's_by_folder_(V2)` calls across multiple folders.
4. Per-folder `Apply_to_each` loops to aggregate items.
5. `Update_file` writes consolidated output artifact.

## Contract and Data Dependencies
- Connectors:
  - `shared_todo` for To Do folder/task reads.
  - `shared_onedriveforbusiness_1` for file metadata and update.
- Data contract:
  - expected folder ids configured in flow steps.
  - output file schema implied by aggregation logic.

## Key Risks
1. Many repeated folder-specific actions increase maintenance drift risk.
2. Hourly cadence with many list operations can hit throttling/performance constraints.
3. File update contention risk if parallel/manual edits occur.
4. No centralized documentation of folder-to-business-domain mapping.

## Recommended Improvements
1. Document folder mapping table and owner for each folder.
2. Add throttling-safe retry/backoff policy notes.
3. Add checksum/version stamp to sync output for change traceability.
4. Consider modularization or generated flow pattern to reduce repeated step drift.

## Evidence Snapshot
- Trigger: `Recurrence` hourly
- Top actions include:
  - `Get_file_metadata_using_path`
  - `Update_file`
  - multiple `List_to-do's_by_folder_(V2)` actions
  - multiple `Apply_to_each` loops
- Connector maps: `shared_todo`, `shared_onedriveforbusiness_1`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

