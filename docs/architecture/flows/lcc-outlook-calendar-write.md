# Flow Detail: LCC Outlook Calendar Write

Status: PROPOSED (Round 2 finding R2-M-3)
Last updated: 2026-05-19
Flow export: (to be added once flow is built — `LCCOutlookCalendarWrite_YYYYMMDDHHMMSS.zip`)
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent

Close the calendar-bridge gap caught by Round 2 finding R2-M-3:
calendar today is read-only into Supabase. LCC cannot push meetings,
follow-up calls, or property-tour invites back into Outlook even though
the cadence engine produces touchpoints that explicitly want a calendar
event ("Phone Follow-Up", "Direct Ask — schedule meeting"). Today every
calendar invite is manually created in Outlook even when LCC already
knows the meeting subject, attendee, and recommended time.

## Why this exists (audit context)

- `LCC - Personal Calendar Sync` (hourly, `shared_outlook` GetEventsCalendarView):
  Outlook → Supabase. Read-only.
- `outlookcalendar-lcc-sync.md`: same direction, similar shape.
- `lcc-microsoft-salesforce-pipeline-gap-analysis.md:37`:
  "Calendar is read from Outlook into Supabase; LCC cannot write or
  update Outlook calendar events."
- `api/_shared/cadence-engine.js:378`: a `touchData.type === 'meeting'`
  branch exists and increments `meetings_scheduled` but there is no
  bridge into Outlook to actually create the meeting.

Net: cadence touches 2, 4, 6 ("Phone Follow-Up") and touch 7 ("Direct
Ask — schedule meeting") produce a recommended action in LCC, Scott
clicks "Mark Sent" or "Mark Done", but every actual calendar invite is
manually authored. The data the cadence engine already has —
contact, property, suggested time, subject template — never reaches
Outlook.

## Trigger

- Type: `Request` (HTTP trigger; LCC POSTs to this flow)
- Trigger URL: PA-generated; stored in Vercel env as
  `OUTLOOK_CALENDAR_WRITE_FLOW_URL` (Vault-managed).

## Request schema (POST body)

```json
{
  "schema_version": "1.0",
  "correlation_id": "<guid>",
  "subject": "Quarterly catch-up with John Doe — DaVita Lakewood",
  "body_html": "<p>LCC-suggested touchpoint follow-up. Property: 1234 Main St ...</p>",
  "start_iso": "2026-05-22T18:00:00Z",
  "end_iso":   "2026-05-22T18:30:00Z",
  "time_zone": "America/Chicago",
  "attendees": [
    { "email": "john@example.com", "name": "John Doe", "required": true }
  ],
  "location":  "Phone (LCC will call)",
  "categories": ["LCC-Cadence", "T-005-quarterly"],
  "online_meeting": false,
  "metadata": {
    "lcc_cadence_id":  "uuid-of-touchpoint_cadence-row",
    "lcc_touch":       6,
    "lcc_entity_id":   "uuid",
    "lcc_property_id": 12345,
    "lcc_domain":      "dialysis"
  }
}
```

`correlation_id` and `schema_version` mirror the Round 76gn calendar
sync hardening pattern so every invite can be traced back to the
specific LCC cadence touch that produced it.

## High-Level Action Topology

1. Trigger on `Request` POST.
2. `Parse_JSON` against the schema above.
3. `Create_calendar_event_(V2)` via `shared_outlook`:
   - Calendar ID: Scott's primary calendar
   - Subject: from request body
   - Start / End: from request body, parsed as the request `time_zone`
   - Required attendees: derived from `attendees[].email` joined with `;`
   - Body: `body_html`
   - Location: from request body
   - Categories: from request body
   - Is online meeting: `online_meeting` (boolean)
   - Reminder minutes before start: `15`
4. `HTTP` POST back to LCC at
   `/api/operations?_route=draft&action=record_calendar_invite`:
   - Body includes the Outlook event ID, web link, and the original
     `metadata.lcc_cadence_id` so LCC can patch
     `touchpoint_cadence.last_calendar_event_id`.
   - Same `X-LCC-Key` Vault header.
5. `Response` to the original LCC caller — 200 with the Outlook event ID
   + web link, or 4xx/5xx with structured error so LCC can showToast
   appropriately.
6. **Failure fault branch** on the `Create_calendar_event_(V2)` step
   posts to `/api/admin?_route=dead-letter` with
   `flow_name='LCC-OutlookCalendarWrite'`, `correlation_id`, and the
   error text.

## Contract and Data Dependencies

- Trigger: `Request` (PA-generated HTTPS URL with a signed-token query
  param; Vault-managed).
- Connector: `shared_outlook` (existing; same connector
  `LCC-PersonalCalendarSync` already uses).
- Calling LCC endpoint: nothing today — see R2-M-3b for the planned
  LCC-side `Schedule meeting` button + cadence-engine wiring.
- Callback LCC endpoint: `/api/operations?_route=draft&action=record_calendar_invite`
  (NEW — see R2-M-3c).

## Bidirectional contract

Once both R2-M-3 (this flow) and R2-M-3c (callback handler) ship, the
loop closes:

```
LCC detail page → POST /api/operations?_route=draft&action=schedule_meeting
                  → operations.js builds the request payload
                  → calls OUTLOOK_CALENDAR_WRITE_FLOW_URL
                  → Power Automate creates the Outlook event
                  → PA POSTs back to LCC with the Outlook event ID
                  → LCC patches touchpoint_cadence.last_calendar_event_id
                  → cadence-engine.recordTouchOutcome('meeting')
                  → cadence advances to the next touch
```

Today the bracketed steps don't exist. This patch authors the middle
piece (the PA flow); R2-M-3b authors the LCC outbound caller; R2-M-3c
authors the callback handler.

## Key Risks

1. **Trigger URL is a credential.** Anyone with the URL can create
   calendar events on Scott's calendar. Mitigate: store in Vault, scope
   to LCC service-role only, rotate quarterly. Same risk pattern as
   the existing flow trigger URLs in `flows/lcc-flagged-email-intake.md`.
2. **Time-zone bugs.** Outlook events created with the wrong TZ land
   at the wrong hour. The flow uses the caller's `time_zone` field
   explicitly and renders via `convertFromUtc` — same pattern as the
   `LCC-PersonalCalendarSync` reverse direction.
3. **Double-booking.** This flow has no awareness of Scott's existing
   calendar. Mitigate (R2-M-3d): before creating the event, query
   `GetEventsCalendarViewV2` for conflicts in the start/end window and
   return 409 if any exist. LCC's caller can then either offer a
   different slot or proceed with a "force=true" param.
4. **Attendee email validation.** Outlook will silently drop attendees
   with malformed emails. Mitigate: validate
   `attendees[].email` in the LCC caller before POSTing.

## Configuration Notes

- Reuse `shared_outlook` connector that
  `LCC - Personal Calendar Sync` already authenticates against — no new
  consent prompt.
- Set the flow's retry policy on the `Create_calendar_event_(V2)` step
  to Exponential (count 3, interval PT5S) — Outlook is occasionally
  throttle-y at the top of the hour.
- Authentication on the inbound trigger: use the PA-generated signed
  URL plus an additional `X-LCC-Caller` header that LCC computes as
  HMAC(`workspace_id + correlation_id`, vault.lcc_api_key) so a leaked
  trigger URL alone can't fire events.

## Recommended Improvements (deferred follow-ups)

- **R2-M-3b**: LCC-side `Schedule meeting` button on the detail page.
  Builds the request payload from the property + contact context, POSTs
  to this flow. Wire from `detail.js` + `api/operations.js`.
- **R2-M-3c**: New `?action=record_calendar_invite` handler in
  `api/operations.js` that accepts the PA callback, patches
  `touchpoint_cadence.last_calendar_event_id`, and advances the cadence.
- **R2-M-3d**: Conflict-detection prefix in the flow (call
  `GetEventsCalendarViewV2` for the request window, 409 on conflict).
- **R2-M-3e**: Bidirectional sync — when the user moves or cancels the
  Outlook event, propagate the change back to `touchpoint_cadence` via
  the existing `LCC - Personal Calendar Sync` hourly pull. Today the
  pull would silently drop those edits because it only reads events
  forward.

## Evidence Snapshot

- Trigger: `Request` (HTTP)
- Top actions: `Parse_JSON`, `Create_calendar_event_(V2)`, `HTTP` callback, `Response`, fault branch to dead-letter
- Connector map: `shared_outlook`

## Change Tracking Hooks

- Snapshot hash (pre-change): `N/A` (new flow)
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

## Closes / blocks

- Closes (when paired with R2-M-3b + R2-M-3c): **R2-M-3** (HIGH) from
  `audit/ROUND_2_FINDINGS_2026-05-19.md`
- Captures follow-ups: R2-M-3b, R2-M-3c, R2-M-3d, R2-M-3e (above)

## How to build

1. In Power Automate, create a new automated flow with trigger
   `When a HTTP request is received`.
2. Define the request schema per the JSON above.
3. Add `Parse_JSON` to validate.
4. Add `Create_calendar_event_(V2)` via `shared_outlook` mapping the
   payload fields.
5. Add `HTTP` POST back to
   `https://life-command-center-nine.vercel.app/api/operations?_route=draft&action=record_calendar_invite`
   with body `{ outlook_event_id, web_link, correlation_id, lcc_cadence_id, lcc_touch }`
   and `X-LCC-Key` header.
6. Add `Response` action that returns 200 + the Outlook event ID, or
   4xx/5xx + error.
7. Add a fault branch on `Create_calendar_event_(V2)` that posts to
   `/api/admin?_route=dead-letter`.
8. Save. PA generates the trigger URL — copy it into Vercel env as
   `OUTLOOK_CALENDAR_WRITE_FLOW_URL` (Vault).
9. Smoke-test by sending a curl POST with a sample payload.
10. Export the flow as ZIP, add to `flow exports/` and entry to
    `FLOW_CHANGES_LOG.md`.

Expected build time: ~60 minutes (PA flow + schema + 3 action steps +
fault branch + Vercel env).
