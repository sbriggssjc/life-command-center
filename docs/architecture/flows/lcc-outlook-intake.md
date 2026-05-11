# Flow Detail: LCC Outlook Intake

Last updated: 2026-05-11
Flow export: `LCCOutlookIntake_20260511212049.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Capture flagged Outlook messages and submit a normalized payload to the LCC Outlook intake endpoint.

## Trigger
- Type: `OpenApiConnectionNotification`
- Operation: `OnFlaggedEmailV3`
- Connector reference: `shared_office365`

## High-Level Action Topology
1. Trigger on flagged email.
2. Initialize variables and iterate attachments.
3. Compose payload fields.
4. POST to `https://life-command-center-nine.vercel.app/api/intake-outlook-message` with `x-lcc-key`.

## Contract and Data Dependencies
- Endpoint dependency: `/api/intake-outlook-message`
- Header dependency: `x-lcc-key`
- Trigger payload depends on Outlook flagged message shape.

## Key Risks
1. Hardcoded environment URL for intake endpoint.
2. Secret header management is flow-side critical dependency.
3. Parallel overlap with other flagged-email intake patterns increases drift risk.

## Recommended Improvements
1. Externalize endpoint base URL and key storage via environment references.
2. Add explicit success/failure branch logging.
3. Align payload schema versioning with other intake flows.

## Evidence Snapshot
- Trigger: `When_an_email_is_flagged_(V3)`
- Top actions: `HTTP`, `Initialize_variable`, `Apply_to_each`, `Compose`
- Connector map: `shared_office365`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

