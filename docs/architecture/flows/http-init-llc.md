# Flow Detail: HTTP Init LLC

Last updated: 2026-05-11
Flow export: `http-initLLC_20260511212018.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Run a manual HTTP-triggered, multi-step OM ingestion sequence:
prepare upload -> upload bytes -> stage OM -> extract intake.

## Trigger
- Type: `Request` (`manual`)
- Connector references: none (uses direct HTTP actions).

## High-Level Action Topology
1. `Init_LccApiKey`
2. `Call_prepare-upload` -> POST `/api/intake/prepare-upload`
3. `Parse_prepare_response`
4. `Decode_bytes`
5. `PUT_to_Supabase` -> dynamic upload URL from prep response
6. `Call_stage-om` -> POST `/api/intake/stage-om`
7. `Parse_stage_response`
8. `Delay`
9. `Call_extract` -> POST `/api/intake-extract?intake_id=...`
10. `Parse_extract_response`
11. `Respond`

## Contract and Data Dependencies
- Endpoints:
  - `/api/intake/prepare-upload`
  - `/api/intake/stage-om`
  - `/api/intake-extract`
- Secret header: `X-LCC-Key`
- Upload auth header used in PUT step (`Authorization`).

## Key Risks
1. Multiple hardcoded endpoint dependencies in one flow.
2. Tight coupling across sequential API calls and parse assumptions.
3. Secret/header handling distributed across multiple actions.
4. Limited resilience if one intermediate step returns schema drift.

## Recommended Improvements
1. Add schema validation guards after each parse step.
2. Add explicit failure branch per stage with structured error response.
3. Externalize URLs/keys into managed references.
4. Add per-step correlation id propagation.

## Evidence Snapshot
- Trigger: `manual` request
- Top actions:
  - `Call_prepare-upload`
  - `PUT_to_Supabase`
  - `Call_stage-om`
  - `Call_extract`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

