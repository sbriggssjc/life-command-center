# LCC Outlook Calendar Write — Build Punch List (Handoff)

**Status at handoff:** ~30% complete. Trigger configured with JSON schema, flow named, Create event (V4) action added. Stopped at the Calendar id dropdown.
**Browser:** Power Automate flow editor is open in Chrome. **Don't navigate away** — PA doesn't auto-save partial flows and you'll lose the schema.
**Estimated remaining time:** ~15 min direct UI work.

## What I left in place

- Flow name: **LCC Outlook Calendar Write**
- Trigger: **When an HTTP request is received**
  - Who can trigger: Any user in my tenant
  - Method: POST (default)
  - JSON schema: generated from the sample payload (matches the spec — schema_version, correlation_id, subject, body_html, start_iso, end_iso, time_zone, attendees[], location, categories[], online_meeting, metadata{lcc_cadence_id, lcc_touch, lcc_entity_id, lcc_property_id, lcc_domain})
- Action 1: **Create event (V4)** (Office 365 Outlook, connected to sabriggs@NorthMarq.com) — placeholder, needs configuration

## Step 1 — Configure Create event (V4)

Click into each field and pick the dynamic content from the trigger body (lightning bolt → "When an HTTP request is received" → field name).

| Field | Value |
|-------|-------|
| Calendar id | Pick your primary calendar from the dropdown (the one your Outlook shows by default) |
| Subject | `body/subject` |
| Start time | `body/start_iso` |
| End time | `body/end_iso` |
| Time zone | Pick **(UTC) Coordinated Universal Time** — request schema's `time_zone` is per-call but PA's Create event V4 time-zone is a static dropdown. Keep UTC; convert at the caller if needed |

Now click **Advanced parameters → Show all** to expose the rest:

| Advanced field | Value |
|----------------|-------|
| Body | `body/body_html` |
| Required attendees | Expression: `join(xpath(xml(json(concat('{"a":', body('Parse_JSON')?['attendees'], '}'))), '//email/text()'), ';')` — actually easier: skip the join expression, just type `body/attendees` and PA will iterate. If it complains, use the simpler expression: in the Expression tab, paste `string(triggerBody()?['attendees'])` and hand-edit downstream. The cleanest path: write a small `Compose` action before Create event that flattens attendees to a string. |
| Optional attendees | (leave blank) |
| Location | `body/location` |
| Reminder | `15` |
| Is reminder on | `true` |
| Show as | `Busy` |
| Categories | Skip for V4 — categories aren't a top-level field, they'd need a separate Update event step. Capture as R2-M-3f. |
| Is online meeting | `body/online_meeting` |

**On the attendees complication:** Create event V4 expects a semicolon-delimited string of email addresses. The schema sends an array of objects. Two clean options:
1. **Add a Compose step** before Create event named `attendee_emails` with expression `join(triggerBody()?['attendees']?[*]?['email'], ';')`. Wire Create event's Required attendees to `outputs('attendee_emails')`.
2. **Simplify the schema** — change the API caller (R2-M-3b) to send `attendees_emails: "a@b.com;c@d.com"` as a pre-joined string. Update the schema and PA Required attendees just maps `body/attendees_emails`.

Recommend option 1 for now — it keeps the schema clean and the array shape preserved for future use (e.g., when R2-M-3d adds conflict detection that needs the full attendee list).

## Step 2 — Add HTTP callback to /api/operations

Click the **+** below Create event (V4) → **Add an action** → search **HTTP** → pick **HTTP** (the built-in one, not "HTTP with Microsoft Entra ID").

| Field | Value |
|-------|-------|
| Method | POST |
| URI | `https://life-command-center-nine.vercel.app/api/operations?_route=draft&action=record_calendar_invite` |
| Headers | `X-LCC-Key: @{vault.lcc_api_key}` (or whatever Vault reference your other flows use; check `LCC Flagged Email Intake` for the canonical pattern) |
| Body | `{ "outlook_event_id": "@{outputs('Create_event_(V4)')?['body/id']}", "web_link": "@{outputs('Create_event_(V4)')?['body/webLink']}", "correlation_id": "@{triggerBody()?['correlation_id']}", "lcc_cadence_id": "@{triggerBody()?['metadata']?['lcc_cadence_id']}", "lcc_touch": "@{triggerBody()?['metadata']?['lcc_touch']}" }` |

## Step 3 — Add Response action

Click the **+** below the HTTP callback → **Add an action** → search **Response** → pick **Response** under Request connector.

| Field | Value |
|-------|-------|
| Status Code | `200` |
| Headers | `Content-Type: application/json` |
| Body | `{ "ok": true, "outlook_event_id": "@{outputs('Create_event_(V4)')?['body/id']}", "web_link": "@{outputs('Create_event_(V4)')?['body/webLink']}", "correlation_id": "@{triggerBody()?['correlation_id']}" }` |

## Step 4 — Add fault branch (parallel) on Create event (V4)

This is the dead-letter pattern. In the designer:
1. Click the **+** that appears between Create event (V4) and the HTTP callback (the connector circle).
2. Pick **Add a parallel branch**.
3. In the new branch: **Add an action** → search **HTTP** → pick **HTTP** (built-in).
4. Configure as below, then click **Settings** (top of the action panel) and under **Run after**, uncheck "is successful" and check "has failed", "is skipped", "has timed out".

| Field | Value |
|-------|-------|
| Method | POST |
| URI | `https://life-command-center-nine.vercel.app/api/admin?_route=dead-letter` |
| Headers | `X-LCC-Key: @{vault.lcc_api_key}` |
| Body | `{ "flow_name": "LCC-OutlookCalendarWrite", "step": "Create_event_(V4)", "correlation_id": "@{triggerBody()?['correlation_id']}", "lcc_cadence_id": "@{triggerBody()?['metadata']?['lcc_cadence_id']}", "error": "@{outputs('Create_event_(V4)')?['body']}" }` |

## Step 5 — Save + smoke test

1. Click **Save** in the top toolbar.
2. PA shows the trigger URL. Click the copy icon next to the **HTTP URL** field in the trigger.
3. Send the URL to me in a new message (or just paste it back here as "trigger url: ...") so I can stash it in your Vercel env as `OUTLOOK_CALENDAR_WRITE_FLOW_URL`.
4. Smoke-test the flow with a synthetic POST (replace `<URL>` with the copied trigger URL):

```bash
curl -X POST "<URL>" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version": "1.0",
    "correlation_id": "test-001",
    "subject": "R2-M-3 smoke test",
    "body_html": "<p>If you see this in your calendar, the flow works.</p>",
    "start_iso": "'$(date -u -d "tomorrow 18:00" +"%Y-%m-%dT%H:%M:%SZ")'",
    "end_iso":   "'$(date -u -d "tomorrow 18:30" +"%Y-%m-%dT%H:%M:%SZ")'",
    "time_zone": "America/Chicago",
    "attendees": [{"email":"sbriggssjc@gmail.com","name":"Scott Briggs","required":true}],
    "location":  "Smoke test",
    "categories": ["LCC-Cadence"],
    "online_meeting": false,
    "metadata": {
      "lcc_cadence_id":  "test-cad-001",
      "lcc_touch":       1,
      "lcc_entity_id":   "test-ent-001",
      "lcc_property_id": 0,
      "lcc_domain":      "dialysis"
    }
  }'
```

Expected: 200 OK with `{ok: true, outlook_event_id: "...", web_link: "https://outlook.office.com/..."}`, plus a new event on your Outlook calendar for tomorrow 18:00 UTC.

If the callback to `/api/operations?_route=draft&action=record_calendar_invite` fails (it doesn't exist yet — R2-M-3c will add it), the Create event itself still succeeds and the callback's 404 lands in flow_run_failures via the dead-letter branch. Acceptable for the first deployment.

## Step 6 — Turn on the flow

After saving, go back to the flow detail page (Back button). Status will be Off (default for new flows). Click **Turn on**.

## What's blocked until this lands

- **R2-M-3b** (LCC outbound caller — `Schedule meeting` button on detail.js): can be built independently but won't function until this flow's trigger URL is in Vercel env.
- **R2-M-3c** (`?action=record_calendar_invite` handler on the LCC side): handler needs to exist so the callback in Step 2 above doesn't 404. Cheap to add; ~30 min of JS work.
- **R2-M-3d** (conflict detection): a follow-on enhancement that adds `Get events (V4)` query before Create event.
- **R2-M-3e** (bidirectional sync — propagate Outlook cancel/move back to LCC): separate; goes through the existing hourly pull flow.

## Open Power Automate issue I noticed

While working on the briefing flows, I saw the parent `LCC Morning Briefing Email` (Sat/Sun) has **Failed** status on its last several runs (May 16, May 17 visible in 28-day history). The new `LCC Weekday Briefing Email` clone inherits the same Connections + HTTP step. It will likely fail the same way until the underlying issue is debugged.

Worth a separate audit pass — probably a Round 3 finding **R3-M-1**: investigate why the LCC briefing email flow has been failing, fix root cause before the weekday volume amplifies the issue.

## Quick summary of remaining sub-tasks

- [ ] Create event (V4) — Calendar dropdown + 7 dynamic content fields
- [ ] Optional: Compose step for attendees join
- [ ] HTTP callback → /api/operations?_route=draft&action=record_calendar_invite
- [ ] Response action → 200 + JSON body
- [ ] Parallel fault branch → /api/admin?_route=dead-letter
- [ ] Save flow
- [ ] Copy trigger URL → send to me
- [ ] Smoke test with curl
- [ ] Turn flow On
- [ ] Investigate the parent briefing flow's failures (R3-M-1 follow-up)
