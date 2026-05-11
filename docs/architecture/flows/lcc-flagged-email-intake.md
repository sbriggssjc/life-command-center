# Flow Detail: LCC Flagged Email Intake

Last updated: 2026-05-11
Flow export: `LCCFlaggedEmailIntake_20260511211601.zip`
Definition path: `Microsoft.Flow/flows/d058be04-a6d7-4636-a846-a0c0b4e34f6a/definition.json`

## Intent
Capture flagged Outlook emails (with attachments), stage/upload attachment payloads, and submit intake payload to LCC for OM/deal processing.

## Trigger
- Type: `OpenApiConnectionNotification`
- Operation: `OnFlaggedEmailV3`
- Connector reference: `shared_office365`
- Trigger parameters observed:
  - `includeAttachments: true`
  - `fetchOnlyWithAttachment: false`
  - specific Outlook folder path id

## High-Level Action Topology
1. Initialize array/int variables.
2. `Apply_to_each` attachments:
   - call LCC upload prep endpoint,
   - parse prep response,
   - upload bytes to provided upload URL,
   - append metadata into attachment array.
3. POST intake payload to LCC:
   - endpoint: `https://tranquil-delight-production-633f.up.railway.app/api/intake?_route=outlook-message`
   - includes `X-LCC-Key`.
4. Condition on intake response status (`200`) to branch success/failure handling.

## Contract and Data Dependencies
- Endpoint dependency: `/api/intake?_route=outlook-message`
- Upload prep endpoint: `/api/intake/prepare-upload`
- Header dependency: `X-LCC-Key`
- Attachment upload uses pre-signed URL from prep response.

## Key Risks
1. Hardcoded endpoint URL dependency.
2. Operational coupling across prep-upload-post stages.
3. Secret header usage pattern requires secure storage and rotation discipline.
4. Folder-specific trigger scope can drift if mailbox structure changes.

## Current Controls (Observed)
- Explicit status-code condition after intake POST.
- Structured attachment loop flow before final intake call.

## Recommended Improvements
1. Move base URLs and sensitive headers to managed environment references.
2. Add explicit failure branch logging payload to audit table/webhook.
3. Add retry/dead-letter handling for upload prep/upload failures.
4. Add correlation id propagation from flow run into intake payload.

## Evidence Snapshot
- Trigger: `When_an_email_is_flagged_(V3)`
- Top actions: `Initialize_variable`, `Initialize_variable_1`, `Apply_to_each`, `HTTP_-_outlook-message`, `Condition`
- Connector map: `shared_office365`
- API map: `shared_office365`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

