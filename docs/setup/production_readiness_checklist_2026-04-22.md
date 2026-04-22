# LCC Production-Readiness Checklist — 2026-04-22

Completed the intake-pipeline rebuild today (Path C staging, pdf-parse via `createRequire`,
state normalization, directional stripping, gov `agency`-column fix, Outlook storage_path
support). Pipeline proven end-to-end on five test intakes across LCC-native, dialysis,
and government domains.

This checklist covers the UI-side deployment steps needed to put today's work into daily use.

---

## 1. Rotate Exposed API Keys (DO FIRST)

Two secrets hit this session's chat transcript and need rotation.

### 1a. `LCC_API_KEY`
Exposed value fragment: `2e046e…b64c`.

1. In Supabase Studio → LCC Opps project → Database → **Functions** or wherever LCC_API_KEY is generated (or generate a fresh 64-char hex from `openssl rand -hex 32` locally).
2. Vercel → `life-command-center` project → Settings → Environment Variables → `LCC_API_KEY` → Edit → paste new value → Save.
3. Redeploy from the Deployments tab so the new key is live.
4. Update the Chrome extension: open the LCC Assistant Settings page → paste the new key into **API Key** → Save.
5. Update your PowerShell `$headers` and any scripts/profiles that reference the old value.
6. **Test**: run any authed curl to confirm (e.g. hit `/api/intake-extract?intake_id=...`). If you see `401`, one of the four update sites didn't take.

### 1b. `DIA_SUPABASE_KEY`
Exposed value fragment: `sb_secret_Zimx…CH` — this is a **service-role** key with full dialysis DB access.

1. Supabase Studio → dialysis project → **Project Settings → API** → Service role → **Generate new key**.
2. Vercel → `life-command-center` → Settings → Environment Variables → `DIA_SUPABASE_KEY` → Edit → paste new value → Save.
3. Redeploy from the Deployments tab.
4. **Test**: run the gov-query / dia-query proxy from PowerShell to confirm domain queries still work.

---

## 2. Deploy the Outlook Flagged-Email Power Automate Flow

Backend now accepts `storage_path` on `attachments[i]` (no 4.5 MB Vercel cap).
Reference: `.github/PA_FLOWS.md` lines 164–182.

**Flow trigger**: "When an email is flagged (V3)" — Outlook → folder: `LCC Intake`.

**Actions (in order)**:

1. **Initialize variable** `LccApiKey` (string) = value of `LCC_API_KEY` from Vercel (do NOT hardcode; store in flow's Environment Variable if you have a Power Platform environment set up, otherwise use a secure input).

2. **Condition** — if `triggerOutputs()?['body/hasAttachments']` is true, branch to attachment handling; else skip to step 6.

3. **Get attachments (V2)** — from `triggerOutputs()?['body/id']`.

4. **Apply to each** over the attachments array. Inside:
   - **HTTP — prepare-upload**:
     - Method: POST
     - URI: `https://life-command-center-nine.vercel.app/api/intake/prepare-upload`
     - Headers: `X-LCC-Key: @{variables('LccApiKey')}`, `Content-Type: application/json`
     - Body: `{"file_name": "@{items('Apply_to_each')?['name']}", "mime_type": "@{items('Apply_to_each')?['contentType']}", "intake_channel": "email"}`
   - **Parse JSON** — schema has `ok`, `storage_path`, `upload_url`, `upload_headers`.
   - **HTTP — PUT bytes**:
     - Method: PUT
     - URI: `@{body('Parse_JSON')?['upload_url']}`
     - Headers: `Content-Type: @{items('Apply_to_each')?['contentType']}`, `x-upsert: true`
     - Body: `@{base64ToBinary(items('Apply_to_each')?['contentBytes'])}`
   - **Append to array variable** `AttachmentRefs` — `{"file_name": "@{items('Apply_to_each')?['name']}", "file_type": "@{items('Apply_to_each')?['contentType']}", "storage_path": "@{body('Parse_JSON')?['storage_path']}"}`

5. (end of Apply to each)

6. **HTTP — outlook-message**:
   - Method: POST
   - URI: `https://life-command-center-nine.vercel.app/api/intake?_route=outlook-message`
   - Headers: `X-LCC-Key: @{variables('LccApiKey')}`, `Content-Type: application/json`
   - Body:
     ```json
     {
       "message_id":          "@{triggerOutputs()?['body/id']}",
       "internet_message_id": "@{triggerOutputs()?['body/internetMessageId']}",
       "subject":             "@{triggerOutputs()?['body/subject']}",
       "body_preview":        "@{triggerOutputs()?['body/bodyPreview']}",
       "body_text":           "@{triggerOutputs()?['body/body/content']}",
       "received_date_time":  "@{triggerOutputs()?['body/receivedDateTime']}",
       "web_link":            "@{triggerOutputs()?['body/webLink']}",
       "from":                "@{triggerOutputs()?['body/from/emailAddress/address']}",
       "has_attachments":     @{triggerOutputs()?['body/hasAttachments']},
       "attachments":         @{variables('AttachmentRefs')}
     }
     ```

**Critical trigger-schema gotcha**: if the flow's trigger uses an auto-generated JSON schema (from a sample payload), regenerate it AFTER making any changes — stale schemas silently drop fields from `triggerBody()`. Same failure mode as old Flow A.

**Test**: flag the `OM Ingestion Test - Gov.eml` email in Outlook. Expect a new `inbox_items` row + `staged_intake_items` row within 15 seconds, matched to gov property 12971.

---

## 3. Rebuild Copilot Studio "Receive OM" Topic

Reference: `docs/setup/copilot_studio_om_topic_2026-04-21.md` — the drop-in rebuild guide.
Five action_ids are live on Vercel:
- `intake.prepare_upload.v1`
- `intake.stage.om.v1`
- `intake.finalize.om.v1`
- `context.retrieve.entity.v1`
- `memory.log.turn.v1`

**Abbreviated steps**:

1. Open Copilot Studio → LCC Deal Agent.
2. **Settings → Connectors** → verify the LCC Deal Intelligence connector is present (imported from `copilot/lcc-deal-intelligence.connector.v1.swagger.json`). If missing, import it from Power Platform Custom Connectors.
3. **Topics → + Add → New topic → Receive OM**.
4. Trigger phrase: *When user uploads a PDF* (or similar natural-language). Ensure topic recognizes file attachments.
5. Node 1 — Action: `intake.prepare_upload.v1`, inputs: `{file_name, mime_type}` from the attachment. Output variable: `prep`.
6. Node 2 — **HTTP** action inside Copilot to PUT bytes to `prep.upload_url`. (This is the part Copilot Studio can't always do natively; may need to offload to a Power Automate child flow.)
7. Node 3 — Action: `intake.stage.om.v1`, inputs: `{storage_path: prep.storage_path, file_name, channel: "copilot"}`. Output: `intake`.
8. Node 4 — Wait 10 seconds, then action: `context.retrieve.entity.v1`, inputs: `{entity_id: intake.property_id}`.
9. Node 5 — Compose a message back to the user summarizing the match.
10. (Optional) Node 6 — action: `memory.log.turn.v1` to log the interaction.
11. Publish the topic. Test in the Copilot Studio test pane with a PDF attachment.

---

## 4. Configure Teams Outbound Webhook

`sendTeamsAlert()` in `/api/_shared/teams-alert.js` fires Adaptive Cards when intakes look like OMs or inquiries. Currently dormant because `TEAMS_INTAKE_WEBHOOK_URL` isn't set.

1. Teams → open the channel where you want alerts (e.g. `LCC Alerts`).
2. Channel ⋯ menu → **Connectors → Incoming Webhook → Configure** → name it "LCC Intake" → upload icon → **Create**.
3. Copy the webhook URL.
4. Vercel → Environment Variables → **add** `TEAMS_INTAKE_WEBHOOK_URL` = pasted URL → Save.
5. Redeploy.
6. **Test**: stage a new OM-ish intake through the sidebar. Expect an Adaptive Card to arrive in the Teams channel within a few seconds.

---

## 5. Clean Up Extension Settings

Path A (Power Automate) is dormant for browser intake now that Path C works. Clear the flow URL in the extension so the fallback never fires:

1. Chrome → Extensions → LCC Assistant → Options (gear).
2. Clear the **Power Automate Flow URL** field.
3. Save.

The flow in Power Automate can stay live for non-browser intake (SharePoint dropzone, mobile shortcuts) once you fix its trigger schema. For the sidebar specifically, Path C is canonical.

---

## 6. Post-Deployment Smoke Tests

Run each after the above are done:

- **Extension intake**: stage a PDF from a CoStar listing; expect `match_result.status: matched` or `unmatched` with a fully populated snapshot.
- **Outlook intake**: flag an email with a PDF attachment in the `LCC Intake` folder; wait 15 seconds; run the `/api/intake-extract?intake_id=X` query on the new intake_id; expect populated fields + match.
- **Copilot intake**: in Copilot Studio test pane, upload a PDF; expect the "Receive OM" topic to walk through prepare-upload → stage → context fetch and reply with a summary.
- **Teams alert**: intentionally stage an OM-ish PDF; expect an Adaptive Card in Teams.
- **Key rotation**: run any authed PowerShell call after rotation; expect 200, not 401.

---

## 7. Known Gaps (Tracked for Phase 2)

- **Image/screenshot intake** (LinkedIn PNG case) — requires branching on `mime_type.startsWith('image/')` in `intake-extractor.js` and routing to Claude vision instead of pdf-parse.
- **Triage feedback loop** — no schema yet for recording human approval/rejection of matcher decisions; blocks self-learning. (Being built this session.)
- **LCC → domain DB writes** — data flows are one-way read-only today.
- **Memory consolidation job** — `activity_events` grows unbounded; needs monthly summarization.
- **Copilot action usage analytics** — raw data in `activity_events` but no rollup.
- **Integration env-var health endpoint** — no way to see at a glance which connectors are keyless.

Revisit Phase 2 once the items above are deployed and proven in daily use.
