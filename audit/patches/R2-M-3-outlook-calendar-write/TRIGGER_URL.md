# LCC Outlook Calendar Write — Trigger URL

Captured: 2026-05-19
Flow ID: `b514a170-62e7-4871-916a-c690bc6f4d6b`
Environment: NorthMarq Capital, LLC (`Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f`)

## Trigger URL

```
https://defaultfccf69d358a44c10a59d14937a5f5d.3f.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/2572cec5c7cc4a41a34bd853dbfaf698/triggers/manual/paths/invoke?api-version=1
```

## Authentication

The trigger is configured with **Who can trigger the flow: Any user in my tenant**, which means PA uses **OAuth 2.0 / AAD-based authentication** (not a SAS signature URL). Callers must include a Bearer token from AAD.

## How to call from LCC (R2-M-3b)

```ts
// In api/_handlers or api/_shared:
async function postToOutlookCalendarWrite(payload) {
  const tokenResp = await fetch(
    `https://login.microsoftonline.com/${process.env.AAD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AAD_CLIENT_ID,
        client_secret: process.env.AAD_CLIENT_SECRET,
        scope: 'https://service.flow.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  );
  const { access_token } = await tokenResp.json();

  return fetch(process.env.OUTLOOK_CALENDAR_WRITE_FLOW_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}
```

## Vercel env additions needed

```
OUTLOOK_CALENDAR_WRITE_FLOW_URL=<the URL above>
AAD_TENANT_ID=<your M365 tenant id — Settings → ID & properties in M365 admin>
AAD_CLIENT_ID=<service-principal client id>
AAD_CLIENT_SECRET=<service-principal secret>
```

The service principal needs the `Flow.Read.All` and `Flow.Execute.All` permissions on https://service.flow.microsoft.com.

## Alternative: switch the flow to anonymous trigger

If AAD setup is too heavy, edit the trigger's **Who can trigger the flow** to **Anyone**. PA then regenerates the URL with an embedded `sv=` + `sig=` SAS-token signature. The caller just POSTs to the new URL — no Bearer token needed. Trade-off: anyone who knows the URL can fire the flow, so the URL becomes credential-equivalent and must stay in Vault.

## Smoke test (once R2-M-3c handler exists or with `--data-binary @payload.json`)

```bash
ACCESS_TOKEN=$(curl -s -X POST \
  "https://login.microsoftonline.com/$AAD_TENANT_ID/oauth2/v2.0/token" \
  -d "client_id=$AAD_CLIENT_ID" \
  -d "client_secret=$AAD_CLIENT_SECRET" \
  -d "scope=https://service.flow.microsoft.com/.default" \
  -d "grant_type=client_credentials" | jq -r .access_token)

curl -X POST "$OUTLOOK_CALENDAR_WRITE_FLOW_URL" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version":"1.0",
    "correlation_id":"smoke-001",
    "subject":"R2-M-3 smoke test",
    "body_html":"<p>If you see this on your calendar, the flow works.</p>",
    "start_iso":"2026-05-22T18:00:00Z",
    "end_iso":"2026-05-22T18:30:00Z",
    "time_zone":"America/Chicago",
    "attendees":[],
    "location":"Smoke test",
    "categories":[],
    "online_meeting":false,
    "metadata":{"lcc_cadence_id":"test","lcc_touch":1,"lcc_entity_id":"test","lcc_property_id":0,"lcc_domain":"dialysis"}
  }'
```

Expected: 202 Accepted (PA's default response for HTTP Request triggers without an explicit Response action) and a new event on Scott's calendar at the requested time.

## Phase 1 limitations (deferred work)

- **No Required attendees on the event** — the PA Required attendees field is a people-picker that doesn't accept array expressions cleanly. Phase 1 events are created without attendees; the caller can manually invite people from the Outlook UI. R2-M-3f follow-up: add a Compose step before Create event that joins `triggerBody().attendees[*].email` via `select(...)` + `join(...)`.
- **No HTTP callback to LCC** — Without it, the LCC side can't link the new Outlook event to its `touchpoint_cadence` row. Build this next (~10 min in PA, ~30 min on the LCC handler side per R2-M-3c).
- **No Response action** — Flow returns 202 default. To return event ID + web link, add a Response action.
- **No parallel fault branch** — Failures land in PA's run history but aren't piped to `lcc_health_alerts`. R2-M-3 closeout doc has the recipe.
- **Time zone fixed at UTC** — Schema includes `time_zone` per-call but PA's Create event V4 time-zone is a static dropdown. For now all events land in UTC; caller should convert to UTC before sending. R2-M-3 closeout has the Compose step recipe to dynamic-route the TZ.

## What is live right now

✅ HTTP-triggered flow with the schema you specified
✅ Authenticated to sabriggs@NorthMarq.com Office 365
✅ Creates events on Scott's primary `Calendar`
✅ Populates Subject, Start, End, Body, Location dynamically from request
✅ Status: TBD (turn on next)

Next: turn the flow On in PA, then either continue adding the callback/Response/fault branch via Chrome or hand off the remaining ~10 min of UI work.
