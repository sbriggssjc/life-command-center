# Outlook -> Intake -> Team Visibility (Wave 1 Production Workflow)

## Objective
Implement Microsoft orchestration for the existing `ingest_outlook_flagged_emails` action without changing backend ingestion logic.

## Endpoints Used
1. `POST /api/sync?action=ingest_emails`
- Purpose: Trigger existing Outlook flagged-email ingestion.
- Owner: LCC (`api/sync.js`, `ingestEmails`).

2. `GET /api/intake-summary?correlation_id=<id>&limit=<n>`
- Purpose: Return Teams-ready intake summary rows for the same ingestion run.
- Owner: LCC (`api/intake-summary.js`).

## Power Automate Flow Spec

### Flow A: Outlook Flag -> LCC Intake -> Teams Notification

Trigger:
- `When an email is flagged (V3)` (Outlook)
- Optional alternate trigger route is Flow B (button/manual) below.

Actions:
1. **Compose_EmailSummary**
- Build a short summary from `bodyPreview`.
- Example expression:
`substring(triggerOutputs()?['body/bodyPreview'], 0, min(length(triggerOutputs()?['body/bodyPreview']), 220))`

2. **HTTP_IngestEmails**
- Method: `POST`
- URI: `https://<LCC_HOST>/api/sync?action=ingest_emails`
- Headers:
  - `Content-Type: application/json`
  - `x-lcc-key: <LCC_API_KEY>`
  - `x-lcc-workspace: <WORKSPACE_ID>`
- Body: `{}`

Expected response payload:
- `sync_job_id`
- `correlation_id`
- `status`
- `processed`
- `failed`

3. **Condition_IngestSucceeded**
- True when HTTP status is 200 and response `status` is `completed` or `partial`.

4. **HTTP_GetIntakeSummary** (on success branch)
- Method: `GET`
- URI: `https://<LCC_HOST>/api/intake-summary?correlation_id=@{body('HTTP_IngestEmails')?['correlation_id']}&limit=1`
- Headers:
  - `x-lcc-key: <LCC_API_KEY>`
  - `x-lcc-workspace: <WORKSPACE_ID>`

5. **Post_message_in_a_chat_or_channel (Teams connector)**
- Channel: configured operations/intake channel.
- Message body uses template below.

6. **Optional failure branch**
- Post error summary to Teams (failed count, correlation id, sync job id).

### Flow B: Manual/Button Trigger -> LCC Intake -> Teams Notification

Trigger options:
- `Manually trigger a flow`
- Optional custom button in Teams/Power Apps.

Actions:
- Reuse same steps as Flow A from `HTTP_IngestEmails` onward.
- This gives "OR button" execution without touching ingestion internals.

## Teams Message Template

Use either markdown text or adaptive card. Below is markdown template.

```text
📥 **New Intake Item Captured**

**Sender:** @{coalesce(first(body('HTTP_GetIntakeSummary')?['items'])?['sender'], triggerOutputs()?['body/from'])}
**Subject:** @{coalesce(first(body('HTTP_GetIntakeSummary')?['items'])?['subject'], triggerOutputs()?['body/subject'])}
**Summary:** @{coalesce(first(body('HTTP_GetIntakeSummary')?['items'])?['summary'], outputs('Compose_EmailSummary'))}

🔗 **LCC Item:** @{coalesce(first(body('HTTP_GetIntakeSummary')?['items'])?['lcc_item_url'], 'https://<LCC_HOST>/?page=pageInbox')}

**Suggested actions:** Triage | Assign | Promote

_Run:_ @{body('HTTP_IngestEmails')?['correlation_id']}  
_Processed:_ @{body('HTTP_IngestEmails')?['processed']}  
_Failed:_ @{body('HTTP_IngestEmails')?['failed']}
```

## Environment / Configuration Required

### LCC / API
- `LCC_API_KEY` (required in request headers for secure API access)
- `x-lcc-workspace` value (workspace UUID used by flow)
- `LCC_APP_URL` (recommended; used by `/api/intake-summary` to generate stable LCC links)

### Power Automate connections
- Outlook connector (`office365`)
- Teams connector (`teams`)
- HTTP action enabled in tenant/environment

### Teams target configuration
- Team and Channel ID for posting notifications
- Service account / connection identity with permission to post

## Setup Instructions

1. **Create or reuse environment variables/secrets**
- Confirm `LCC_API_KEY` is set in LCC runtime.
- Set `LCC_APP_URL` to production URL (for example: `https://life-command-center-nine.vercel.app`).

2. **Import flow template**
- Import `flow-outlook-intake-to-teams.json`.
- Bind Outlook + Teams connections.

3. **Configure HTTP action values**
- Replace `<LCC_HOST>`, `<LCC_API_KEY>`, `<WORKSPACE_ID>` placeholders.

4. **Configure Teams destination**
- Select Team + Channel for intake notifications.

5. **Test with flagged email**
- Flag a real email in Outlook.
- Verify ingest API returns success.
- Verify Teams message includes sender/subject/summary/link.
- Verify link opens LCC intake context.

6. **Enable manual fallback flow (optional but recommended)**
- Import/configure `flow-outlook-intake-button-to-teams.json`.
- Use for operator-controlled re-runs.

## Notes
- No ingestion pipeline logic was modified.
- No new database objects were added.
- No UI features were added.
