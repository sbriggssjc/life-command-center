# Flow Detail: RCM Power Automate

Last updated: 2026-05-11
Flow export: `RCMPowerAutomate_20260511214031.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Ingest new RCM-related emails from Outlook and forward parsed content to LCC RCM ingestion endpoint.

## Trigger
- Type: `OpenApiConnectionNotification`
- Operation: `OnNewEmailV3`
- Connector references:
  - `shared_office365`
  - `shared_conversionservice`

## High-Level Action Topology
1. Trigger on new email.
2. Convert HTML to text.
3. POST to `https://life-command-center-nine.vercel.app/api/rcm-ingest`.
4. Mark email read/unread.
5. Conditional branch checks response string content.

## Contract and Data Dependencies
- Endpoint dependency: `/api/rcm-ingest`
- Header dependency: `X-PA-Webhook-Secret`
- Conversion service dependency for html-to-text.

## Key Risks
1. Hardcoded endpoint URL.
2. String-contains condition checks can be brittle versus structured response contracts.
3. Secret header handling must remain in managed secure references.

## Recommended Improvements
1. Move to structured response schema and status/code checks.
2. Add explicit dead-letter path for ingestion failures.
3. Externalize URL + secret references.

## Evidence Snapshot
- Trigger: `When_a_new_email_arrives_(V3)`
- Top actions: `Html_to_text`, `HTTP`, `Mark_as_read_or_unread_(V3)`, `Compose`, `Condition`
- HTTP endpoint: `/api/rcm-ingest`
- Connector maps: `shared_office365`, `shared_conversionservice`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

