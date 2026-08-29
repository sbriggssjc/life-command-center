# Lease Abstract Pass — 5247 Airways / Lease 16307

## Objective
Populate the live Dialysis_DB lease row for property `23654` / lease `16307` from the on-file lease PDF, without fabricating absent terms.

Target fields:
- `guarantor`
- `guaranty_scope`
- `roof_responsibility`
- `structure_responsibility`
- `parking_responsibility`
- `hvac_responsibility`

## Grounding Rules
- Use the lease PDF / extracted lease text only.
- If the document is silent, leave the DB field null and render `Not on file`.
- For computed dossier values, label `Derived` with inputs.
- Owner is never the operator.

## 2026-08-01 Notes
- Live Dia lease `16307` currently has tenant/rent/term/NN populated.
- Live blanks confirmed: `guarantor`, `roof_responsibility`, `structure_responsibility`, `parking_responsibility`, `hvac_responsibility`.
- No existing Dia `leases` guaranty-scope column was exposed via PostgREST candidate checks; added canonical `guaranty_scope text` via migration and applied it live.
- Existing lease extractor already uses `invokeExtractionAI`; this pass extends that seam instead of creating a parallel extractor.

## Source PDF Reviewed
Correct on-file source found locally:
`C:\Users\scott\OneDrive - NorthMarq Capital, LLC\Team Briggs - Documents\Dialysis Research\Comps\On Market\_added or updated in comps spreadsheet\DaVita_Memphis-Airways_Contact-Info_Package_9.22.17_rd.pdf`

Rejected mismatch:
`...\PROPERTIES\D\DaVita\Memphis, TN\rec'd\final lease signed by Davita.pdf` refers to 0 Shelby Street / a 2009 Total Renal Care lease, not 5247 Airways.

## Grounded Extracted Values
- Guarantor: `DaVita Incorporated`
- Guaranty scope: not stated in the reviewed source PDF. Live value is null; render `Not on file`.
- Roof: `shared` — PDF says maintenance, repair, and replacement are subject to tenant reimbursement, while landlord performs/maintains.
- Parking: `shared` — same reimbursement/performance split.
- HVAC: `shared` — same reimbursement/performance split.
- Structure: `landlord` — PDF says landlord, at landlord's sole cost and expense, maintains/replaces concrete slab, footings, foundation, structural components, exterior walls, flooring system, exterior plumbing, and electrical systems.

## Live Write
Patched Dialysis_DB lease `16307` with:
- `guarantor = 'DaVita Incorporated'`
- `roof_responsibility = 'shared'`
- `parking_responsibility = 'shared'`
- `hvac_responsibility = 'shared'`
- `structure_responsibility = 'landlord'`
- `guaranty_scope = null` (column exists; source is silent)

Verified live row after write.
