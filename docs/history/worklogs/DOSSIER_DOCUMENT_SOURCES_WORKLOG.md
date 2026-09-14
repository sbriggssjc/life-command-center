# Dossier Document Sources Worklog

## Objective
Wire every document source for dossier/property documents onto the asset entity documents surface without fabricating facts. Target record: property 23654 / asset entity `bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0` (5247 Airways Blvd, Memphis, TN 38116).

## Grounding Rules
- Absent fields remain absent or render as "Not on file".
- Computed matches are labeled through source metadata; conflicts are surfaced, not silently resolved.
- Owner is never inferred from operator/tenant.

## Current Finding
`api/_handlers/entities-handler.js?action=documents` only reads `staged_intake_promotions -> staged_intake_artifacts`. It misses:
- `lcc_cre_property_documents` via the generic CRE registry, keyed by `cre_property_id`.
- Domain Salesforce `sf_files` rows discovered by the `intake-salesforce-files` flow and reachable through `sf_*_staging.linked_property_id`.
- Per-document reconciliation/date fields expected by dossier v2.

## Plan
1. Resolve the asset entity to its canonical domain property identity from `external_identities`.
2. Build a CRE registry map by matching the domain property address/state to `lcc_cre_properties`.
3. Fold intake, CRE folder feed, and Salesforce file-discovery rows into one normalized document list.
4. Add `reconciled`, `reconciled_status`, `date`, and `source_history` fields for dossier consumption.
5. Verify the documents endpoint behavior with a focused unit test and, if credentials are present, live-check property 23654.

## Progress
- 2026-08-01: Read `AGENTS.md`, `CLAUDE.md`, `.github/AI_INSTRUCTIONS.md`, and dossier v2 specs before editing `/api/`.
- 2026-08-01: Added a shared document gatherer in `api/_handlers/entities-handler.js`:
  - Resolves asset entity -> domain property through `external_identities`.
  - Maps domain property -> `lcc_cre_properties` by `normalized_address + state`.
  - Reads `lcc_cre_property_documents` and marks mapped rows `linked_to_record`.
  - Reads domain Salesforce `sf_files` through `sf_comp_staging` / `sf_listing_staging` / `sf_deal_staging.linked_property_id`.
  - Normalizes all sources to `file_name`, `doc_type`, `source`, `date`, `reconciled`, `reconciled_status`, and `source_history`.
  - Reuses the same gatherer for `action=documents` and the dossier property packet.
- 2026-08-01: Added `source_status` to the documents response so source-level gaps are visible when no per-document row exists.
- 2026-08-01: Live verification for asset `bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0` / dia property `23654`:
  - Documents returned: 4.
  - Per-document statuses: 4 `linked_to_record`.
  - Source counts: `supabase` 1, `lcc-om-uploads` 3.
  - Source status: `intake_artifacts` linked; `cre_property_documents` not yet reconciled; `salesforce_files` not yet reconciled.
  - CRE diagnostics: no `lcc_cre_properties` or `lcc_cre_property_documents` candidates found for Airways/Memphis/DaVita.
  - SF diagnostics: no `sf_files.linked_property_id=23654`, no `sf_*_staging.linked_property_id=23654`, no Airways/Memphis SF file candidate. Broader DaVita SF files exist, but none match or link to 5247 Airways.

## Verification
- `node --check api/_handlers/entities-handler.js`
- `node --test test/contact360-role.test.mjs`
- `node --test test/dossier-generator.test.mjs`
- Live Supabase verifier against 23654 using `.env.local` credentials.
