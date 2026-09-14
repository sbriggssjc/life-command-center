# Power Automate Export, Retention, and AI Handoff Standard

**Status:** canonical operating procedure; 2026-08-11 baseline complete
**Owner:** LCC control plane
**Effective:** 2026-08-11
**Purpose:** export each production flow once as a verified baseline, retain it locally, and request later exports only when the deployed flow changes.

## Governing rule

Raw Power Automate packages are evidence of deployed behavior. They are not disposable chat attachments. Every reviewed package must be retained with its immutable flow ID, export date, checksum, deployed-state metadata, and a sanitized repository record.

Future Codex, Claude, ChatGPT, and Copilot work must read this file, `FLOW-REGISTRY.yaml`, the relevant per-flow runbook, and the retained package before asking Scott for another export. A flow is re-exported only when its production `last modified` timestamp is later than the registry's `last_exported_at`, or the retained package is missing/corrupt.

## Raw-package location

Save production packages inside the local LCC checkout at:

`C:\Users\scott\life-command-center\private\power-automate\exports\production\YYYY-MM-DD\`

Use these subfolders:

1. `01-salesforce-backbone`
2. `02-salesforce-files`
3. `03-outlook-task-loop`
4. `04-intake-reporting`
5. `05-retired-historical`

The repository `.gitignore` excludes `private/power-automate/`. Do not force-add ZIPs. Raw packages can contain tenant IDs, endpoint references, connection metadata, or secrets.

## Filename standard

Rename each ZIP after export:

`<logical-flow-id>__<production-display-name>__<flow-guid>__YYYY-MM-DD.zip`

Sanitize the display name for Windows filenames: replace `->`, `→`, `/`, `:`, and repeated spaces with `-`; preserve the immutable GUID exactly. Example:

`sf-object-sync__SF-LCC-Object-Sync__503d5519-221e-4014-bde8-c483b6a8ef10__2026-08-11.zip`

## What to capture with every export

For each flow, update `docs/os/FLOW-REGISTRY.yaml` with:

- logical flow ID and exact production display name;
- immutable flow GUID and environment ID;
- solution name or `non-solution`;
- owner and operational owner;
- on/off and retirement state;
- trigger type and cadence;
- connection references by connector name only;
- endpoint families and primary tables/queues;
- Power Automate `last modified` timestamp;
- export timestamp and relative raw-package path;
- SHA-256 checksum;
- last successful run and verification status;
- runbook path and superseded-flow links.

Never place secret values, signed URLs, connection tokens, webhook URLs containing credentials, or raw client/contact data in the sanitized registry.

## Export procedure

Preferred method: export from a Power Platform Solution so connection references and environment variables are explicit. If the flow is not solution-aware, use **My flows > select flow > Export > Package (.zip)**.

For every flow:

1. Open the production flow and confirm the exact display name.
2. Open **Details** and record the flow GUID from the URL, owner, environment, on/off state, solution, and modified timestamp.
3. Confirm the most recent successful run and record its UTC timestamp.
4. Export the unmanaged solution/package ZIP without unpacking it.
5. Rename it using the filename standard and save it in the dated local folder.
6. Do not edit the ZIP.
7. Update the registry record and calculate the SHA-256 checksum.
8. Review/sanitize the package into a per-flow contract summary; update the existing runbook rather than creating a duplicate.
9. Mark the registry record `verified_from_export` only after package parsing agrees with the production details.

## Baseline export set — 2026-08-11

**Completed 2026-08-11.** All 16 requested packages plus the supplemental HTTP-Switch Salesforce lookup flow
were parsed, fingerprinted, and retained. See `FLOW-REGISTRY.yaml` and `POWER-AUTOMATE-DEPLOYED-CATALOG.md`.
Do not request these packages again unless the delta-only policy below applies.

### Batch A — export first (shared Salesforce backbone)

1. `SF -> LCC: Object Sync`
2. `SF -> LCC: Property Promotion`
3. `SF Deal -> LCC Opportunity Sync` (also documented with the arrow variant)
4. `SF Deal Team -> LCC Roster`
5. `SF Deal Contacts -> LCC Roster`
6. `Sync SF Activities to Supabase`
7. `LCC -> SF Queue Drainer`
8. `SF -> LCC: Retry & Dead-letter`

### Batch B — export second (Salesforce file backbone)

9. `SF -> LCC: File Discovery & Move` (export even though an older import package exists)
10. `SF -> LCC: Daily Bulk File Backfill`
11. `SF -> LCC: On-demand File` (use exact production name if it differs)
12. `SF -> LCC: On-demand Backfill`

### Batch C — export third (current Outlook/task loop)

13. `Outlook Intake to Teams (Hardened)` or its current exact production display name
14. `LCC Processing Complete -> Move Message`
15. `LCC To-Do Completion Poll`
16. `LCC Flagged Email Intake`

Do not export the retired `To Do - Life Command Center Sync` or `Unflag Completed Email Tasks` in the active baseline. If they remain in the tenant, capture only screenshots/details and place any one-time historical exports in `05-retired-historical`.

## Delta-only re-export policy

A new package is required when any of the following changes:

- flow definition, trigger, action, expression, schema, or endpoint;
- connection reference, environment variable, owner, solution, or enablement state;
- immutable flow GUID because of recreate/import-as-new;
- security posture or secret-handling pattern;
- production behavior diverges from the retained export;
- a failure investigation requires the currently deployed definition.

No new package is required for run-history-only changes. Record health and incident evidence in the registry/change log instead.

## Required change-control closure

Any chat or agent that changes a flow must finish by:

1. updating `docs/architecture/flows/FLOW_CHANGES_LOG.md`;
2. re-exporting the changed production flow after deployment;
3. saving the new ZIP under the new date without overwriting the prior baseline;
4. updating `FLOW-REGISTRY.yaml`, checksum, and per-flow runbook;
5. marking the prior package `superseded`, not deleting it; and
6. recording success-path and failure-path validation evidence.

This closure is part of the definition of done. A flow change is not fully documented until the post-deployment package is retained and registered.
