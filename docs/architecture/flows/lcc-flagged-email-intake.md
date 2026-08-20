# Flow Detail: LCC Flagged Email Intake

Last updated: 2026-08-19
Flow export (current): `private/power-automate/exports/production/LCCFlaggedEmailIntake_20260819220833.zip`
Flow export (prior known-good): `LCCFlaggedEmailIntake_20260811031837.zip`
Definition path: `Microsoft.Flow/flows/d058be04-a6d7-4636-a846-a0c0b4e34f6a/definition.json`
Flow id: `d058be04-a6d7-4636-a846-a0c0b4e34f6a`

## Intent
Capture flagged Outlook emails (with attachments), stage/upload attachment payloads, and submit intake payload to LCC for OM/deal processing. As of 2026-08-19 the payload is also enriched with the full HTML body and to/cc recipient lists.

## ⚠️ 2026-08-19 incident + fix — "LCC Intake folder not processing"
**Symptom:** flagged emails (incl. real OMs like the 337 E. Coronado Rd. deal) never landed in `staged_intake_items`; the flow "failed a bunch" with:
`Action 'Select' failed: The 'from' property value in the 'select' action inputs is of type 'String'. The value must be an array.`

**Root cause:** the flow had been enhanced (after the 2026-08-11 snapshot) to add `body_html` (via `Get_email_(V2)`) and `to_recipients`/`cc_recipients` (via `Select`→`Join` / `Select_1`→`Join_1`). Those Select actions read `@triggerOutputs()?['body/toRecipients']` (and `ccRecipients`) assuming a **Graph-style array of `{emailAddress:{name,address}}`** — but the **`When an email is flagged (V3)` trigger returns To/Cc as plain semicolon-separated STRINGS**. A string can't feed a `Select`, so the action errored on **every run**, killing the whole flow *before* the attachment loop or intake POST. (Attachments were never the problem — that hypothesis was wrong.)

**Fix (applied 2026-08-19):** deleted `Select`, `Join`, `Select_1`, `Join_1`; repointed the payload to the trigger's already-formatted strings — `to_recipients = @{triggerOutputs()?['body/toRecipients']}`, `cc_recipients = @{triggerOutputs()?['body/ccRecipients']}`; set `Apply_to_each` runAfter → `Initialize_variable_1`; kept `Get_email_(V2)` (body_html) and the attachment loop untouched. Verified live: Coronado OM finalized (`337 E. Coronado Rd.`, AZ) from the real 7.28 MB PDF; backlog drained; junk still correctly discarded.

**Doctrine note:** the flagged-V3 trigger's recipient/`from` string shape ≠ Graph's object shape. Never `Select`/`item()?['emailAddress']?['address']` over trigger recipient fields; use the strings directly, or Select over `Get_email_(V2)`'s array if display names are needed.

## Trigger
- Type: `OpenApiConnectionNotification`
- Operation: `OnFlaggedEmailV3`
- Connector reference: `shared_office365`
- Trigger parameters observed:
  - `includeAttachments: true`
  - `fetchOnlyWithAttachment: false`
  - specific Outlook folder path id

## High-Level Action Topology (live 2026-08-19)
1. Initialize variables (`LccApiKey`, `AttachmentRefs`).
2. `Get_email_(V2)` — fetch full message for `body_html`.
3. `Apply_to_each` attachments:
   - call LCC upload prep endpoint (`/api/intake/prepare-upload`),
   - parse prep response,
   - PUT bytes to the pre-signed upload URL using `@base64ToBinary(items('Apply_to_each')?['contentBytes'])`,
   - append `{file_name,file_type,storage_path}` into `AttachmentRefs`.
4. POST intake payload to LCC:
   - endpoint: `https://tranquil-delight-production-633f.up.railway.app/api/intake?_route=outlook-message`
   - includes `X-LCC-Key`; body carries `body_text`, `body_html`, `to_recipients`, `cc_recipients`, `from`, `attachments`, message ids.
5. Condition on intake response → `Move_email_(V2)` to Processed + `Flag_email_(V2)` notFlagged + `Mark_as_read` on success; `PostDeadLetter` + Terminate(Failed) on error.

**Removed 2026-08-19 (broken):** `Select`/`Join`/`Select_1`/`Join_1` recipient-transform actions — see the incident section above.

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

## Evidence Snapshot (2026-08-19 live export)
- Trigger: `When_an_email_is_flagged_(V3)` (`OnFlaggedEmailV3`), `includeAttachments:true`, `fetchOnlyWithAttachment:false`, folder-id-pinned (binding verified correct on 2026-08-19).
- Actions: `Initialize_variable`(LccApiKey), `Initialize_variable_1`(AttachmentRefs), `Get_email_(V2)`, `Apply_to_each`(HTTP prep → Parse → HTTP_-_PUT_bytes → Append), `HTTP_-_outlook-message`, `Condition`(Move/Flag/MarkRead/Terminate), `PostDeadLetter`, `Terminate_1`.
- Connector/API map: `shared_office365`.
- **Live-verified fix run 2026-08-19 ~22:41–22:42Z:** Coronado OM finalized from `337-E.-Coronado-Rd.-OM.pdf` (AZ); multiple OMs finalized/matched/review; junk discarded.

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

