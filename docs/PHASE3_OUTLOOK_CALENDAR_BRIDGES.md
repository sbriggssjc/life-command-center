# Phase 3 — Outlook + Calendar Bridges

Phase 3 closes the inbound communication loop. Once SF activities (Phase 1)
+ SharePoint docs (Phase 2) + email + calendar all flow into LCC, the
"this contact has gone cold" alert and engagement scoring become real,
and the cadence engine has the inputs it needs to nudge the user
proactively.

## What ships

| Component | Path | Purpose |
|-----------|------|---------|
| Migration | `supabase/migrations/20260605000000_phase3_outlook_calendar.sql` | Adds metadata columns to `email_bodies` (subject/from/to/cc/etc.), unique idx for idempotent upserts, `v_contact_engagement` view. |
| Seed     | `supabase/seeds/phase3_outlook_calendar_bridges.sql` | Two bridge rows: `outlook.messages` and `calendar.events`, both `requireSourceUser=true`. |
| Handlers | `api/_shared/bridge-handlers-outlook.js` | `handleOutlookMessageExtract` + `handleCalendarEventLink`. |
| Router   | `api/bridges.js` (updated) | Adds `outlook` + `calendar` to `INGEST_SOURCES`, wires both handlers into `HANDLERS`. New `requireSourceUser` config flag forces `X-LCC-Source-User-Id` for these bridges. |
| Rewrites | `vercel.json` | `/api/outlook-changes` + `/api/calendar-changes` → consolidated router. |

> **Function count:** still zero new Vercel functions. Phase 3 plugs into
> the existing `api/bridges.js` router. (Total functions stay at 12.)

## Headline payoff: `v_contact_engagement` + "going cold"

After Phase 3 is running:

```sql
-- Contacts going cold (no touch in 30+ days)
select full_name, email, company_name, days_since_last_touch
from v_contact_engagement
where days_since_last_touch >= 30
  and sf_contact_id is not null   -- only SF-tracked contacts
order by days_since_last_touch desc
limit 50;

-- Emails to/from a specific contact
select subject, from_email, received_at, is_sent, has_attachments
from email_bodies
where workspace_id = '<ws>'
  and (from_email = 'bob@acme.com' or to_emails ? 'bob@acme.com')
order by received_at desc
limit 20;

-- Upcoming meetings with tracked attendees
select subject, starts_at, organizer_email,
       jsonb_array_length(entity_links) as tracked_count
from meetings
where workspace_id = '<ws>' and starts_at >= now()
order by starts_at asc;
```

A daily cron over `v_contact_engagement` is the foundation for the
"reach out — Bob hasn't heard from you in 35 days" Teams notification.

## Privacy model

The constraint that drove the per-user design: corporate Microsoft 365
doesn't grant LCC tenant-level mail/calendar.read application
permissions. The only path is **delegated** — each user authorizes
their own Power Automate flow against their own mailbox.

That means Phase 3 has these built-in privacy gates:

1. **Each user opts in by building their own flow.** No flow = no data
   from that user.
2. **Only emails/events touching tracked contacts are stored.** The
   handler drops anything where no party appears in `unified_contacts`.
   Personal email, marketing newsletters, and untracked internal noise
   never land in the DB. Drop reason: `no_tracked_party` /
   `no_tracked_attendee` (visible in `bridge_runs.drop_reasons`).
3. **`source_user_id` is required on every row.** The bridge config has
   `requireSourceUser: true`; the receiver rejects with 400 if the
   `X-LCC-Source-User-Id` header / `body.source_user_id` field is
   missing.
4. **Body access is gated to source user + workspace managers** at the
   API layer. Phase 3.5 will add Postgres RLS as defense in depth.
5. **Drafts are dropped** (`isDraft` true → `skipped_by_filter`) — they're
   not real touches and may still be edited.

## Per-user PA flow specs

Each LCC user adds two flows once. Both use Graph delta queries so the
incremental load is small.

### outlook.messages (per user)

```
Trigger: Recurrence (every 15 min)
  ↓
Initialize variable: deltaUrl
  ← if first run: "https://graph.microsoft.com/v1.0/me/messages/delta?$select=id,internetMessageId,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft,isRead"
  ← else:        bridge.watermark.delta_link from /api/admin/bridges
  ↓
Do until deltaUrl is null:
  HTTP — GET deltaUrl  (uses the user's M365 connection)
    ↓
  HTTP — POST /api/outlook-changes?bridge=outlook.messages
    Headers:
      X-LCC-Key:            <LCC_API_KEY>
      X-LCC-Source-User-Id: <this user's LCC user UUID>
      X-LCC-Workspace:      <workspace UUID>
      Content-Type:         application/json
    Body:
      {
        "bridge": "outlook.messages",
        "workspaceId": "<workspace-uuid>",
        "runId": "@{workflow().run.name}",
        "records": @{body('HTTP').value},
        "watermark": { "delta_link": "@{body('HTTP')['@odata.deltaLink']}" }
      }
    Note: send watermark only on the LAST page (deltaLink present, not nextLink).
    ↓
  Set deltaUrl ← @odata.nextLink OR null when @odata.deltaLink is set.
```

### calendar.events (per user)

Same shape, but against `/me/calendarView/delta` (or `/me/events/delta`):

```
GET https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=<14d ago>&endDateTime=<60d ahead>&$select=id,iCalUId,subject,bodyPreview,start,end,location,isOnlineMeeting,onlineMeetingUrl,organizer,attendees,createdDateTime,lastModifiedDateTime
```

Then POST to `/api/calendar-changes?bridge=calendar.events` with the
same headers + body shape (replace `records` with the calendar value
array).

### Where each user finds their LCC user UUID

```
GET /api/me        (rewrites to /api/admin?_route=me)
```

Returns `{ id, email, ... }` — copy `id` into the PA flow's variable.

## Allowlists (carried fields)

### outlook.messages → Message
```
id, internetMessageId, conversationId,
subject, bodyPreview, body,
from, toRecipients, ccRecipients,
receivedDateTime, sentDateTime,
hasAttachments, isDraft, isRead
```

### calendar.events → Event
```
id, iCalUId, subject, bodyPreview,
start, end, location, isOnlineMeeting, onlineMeetingUrl,
organizer, attendees,
createdDateTime, lastModifiedDateTime
```

Anything else Graph returns is dropped at ingest. Nested objects (`from`,
`toRecipients`, `attendees`, `start`, etc.) are allowed as units — the
handler walks into them.

## What lands per record

### outlook.messages → email_bodies row

- `internet_message_id`, `conversation_id`, `subject`
- `body_preview`, `body_format`, `body_text` OR `body_html` (one or the other based on Graph's `body.contentType`)
- `from_email`, `from_name`, `to_emails` (jsonb array), `cc_emails` (jsonb array)
- `has_attachments`, `is_sent` (true if from address is NOT one of the tracked contacts — i.e. source user is the sender)
- `received_at`, `sent_at`
- `source_user_id`

Plus a `last_email_date` PATCH on every tracked contact in the message,
and `total_emails_sent += 1` on each recipient when `is_sent=true`.

### calendar.events → meetings row

- `external_id` (Graph event id), `ical_uid`, `subject`
- `starts_at`, `ends_at`, `location`, `is_online_meeting`
- `organizer_email`, `source_user_id`
- `attendees` (jsonb): trimmed `[{email, name, type, response}]`
- `entity_links` (jsonb): `[{unified_id, email, full_name, sf_contact_id}]` — one per tracked attendee. Sidebar can render these without joining `unified_contacts`.
- `metadata.body_preview`, `metadata.online_meeting_url`

Plus a `last_meeting_date` PATCH on every tracked attendee.

## Deployment steps

1. **Apply the Phase 3 migration** to OPS Supabase (`xengecqvemvfknjvbvrq`).
2. **Run the seed** per workspace:
   ```sh
   psql "$OPS_SUPABASE_DB_URL" \
     -v workspace_id="'<workspace-uuid>'" \
     -f supabase/seeds/phase3_outlook_calendar_bridges.sql
   ```
3. **Each user builds their two PA flows** per the specs above.
4. **Verify** by querying:
   ```sql
   select bridge_key, last_run_at, rows_accepted, drop_reasons
   from connector_bridges b
   left join lateral (
     select rows_accepted, drop_reasons from bridge_runs
     where bridge_id = b.id order by started_at desc limit 1
   ) r on true
   where bridge_key in ('outlook.messages','calendar.events');
   ```
   Initial sweep of the user's mailbox/calendar may produce hundreds of
   rows; subsequent runs should be small.

## What's deferred to Phase 3.5

- **Activity-events integration.** Email and meeting touches don't yet
  land in the global `activity_events` timeline. Once we resolve every
  `unified_contacts.unified_id` to a corresponding `entities.id` (for
  the `actor_id` and `entity_id` FKs), the handlers can write timeline
  rows alongside the body/meeting upsert.
- **email_bodies RLS.** Defense-in-depth row-level security so body
  columns are only readable by source user + managers, even if the
  service role token leaks. Requires a per-user JWT routing change
  elsewhere in LCC.
- **Body retention sweep.** A nightly cron that prunes
  `email_bodies.body_text` / `body_html` after N days while keeping
  metadata. Suggested default: 180 days. Implement as a `_route=worker`
  handler triggered by a tagged enrichment_jobs row.
- **Engagement score computation.** `v_contact_engagement` exposes the
  raw inputs; a separate cron should compute and persist
  `unified_contacts.engagement_score` from
  `(recency, frequency, channel_diversity)`.
- **Generic `external_user_mappings` table.** Phase 1.5's
  `salesforce_user_mappings` proposal should be generalized to map
  `(source_system, external_id) → users.id` so SF OwnerIds, SP
  `lastModifiedBy.user.id`, and Outlook source users all resolve
  through one place.

## Known limitations to revisit

- **`is_sent` heuristic.** The handler infers direction from "is the
  from-address a tracked contact?" — if the source user emails another
  internal Northmarq employee who isn't in `unified_contacts`, `is_sent`
  may end up wrong. Resolving the source user's actual email address
  from `users.email` would make this exact.
- **Meeting recurrence.** Recurring events come through the delta as
  series masters + occurrences. The handler currently treats them
  uniformly (both upsert by `external_id`). Distinct occurrences will
  collide with the series id; the meetings table needs an
  `occurrence_id` column to support full recurrence later.
- **Attendees-only matching.** Calendar events without an organizer or
  with only untracked attendees are dropped. Some genuinely interesting
  meetings (an internal-only strategy session about Acme Properties)
  won't land. A `subject contains tenant name` fallback could rescue
  them; deferred until we see the data.
