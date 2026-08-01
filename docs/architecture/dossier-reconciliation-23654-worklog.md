# Dossier Reconciliation 23654 Worklog

## Objective
Read-only reconciliation of the v2 gold-standard dossier design for 5247 Airways Blvd, Memphis, TN 38116 against the production property-panel/contact360/dossier code path and the current live values for dialysis property_id 23654 / CCN 442740 / OPS asset entity bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0.

## Instructions
- Do not fix production code or data in this pass.
- Use `docs/architecture/dossier-standard-and-llm-contract.md` section 3 plus sections 7 and 8, and `docs/architecture/dossier-example-5247-airways-v2.html` as the design target.
- Grounding rule: never fabricate; absent fields are "Not on file"; computed fields are labeled "Derived" with inputs; conflicts are surfaced; owner is never the operator.

## Trace Plan
- Inspect `detail.js` property-panel loaders and client dossier builder.
- Inspect `api/_handlers/entities-handler.js` for `portfolio`, `contact360`, and `documents`.
- Query live read paths for property 23654 and asset entity bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0.
- Write the field-by-field reconciliation to `docs/architecture/dossier-design-vs-production-23654.md`.

## Findings So Far
- The production property-panel dossier button is the client-side v1 builder in `detail.js`; it does not call the newer server-side dossier packet/generator.
- The property panel loads core rows from `v_property_detail`, `v_lease_detail`, `v_ownership_current`, `v_ownership_chain`, `v_property_rankings`, supplemental `properties`, and lazy Operations/Deal/Documents calls.
